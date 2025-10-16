import type { NextRequest } from "next/server"
import { GoogleGenAI } from "@google/genai"

// The client gets the API key from the environment variable `GEMINI_API_KEY`
const ai = new GoogleGenAI({})

type AnalyzeBody =
  | {
      mode: "snippet"
      files: { path: string; content: string }[]
    }
  | {
      mode: "github"
      owner: string
      repo: string
      ref: string
      paths: string[]
    }

type AnalyzeResponse = {
  text?: string
  error?: string
  truncated?: boolean
  totalBytes?: number
  fileCount?: number
}

const GH_API = "https://api.github.com"

// Limits to keep prompts within model context:
// Adjust conservatively for safety; we also summarize if needed.
const MAX_TOTAL_BYTES = 200_000
const MAX_FILE_BYTES = 40_000
const MAX_FILES = 50

function bytes(str: string) {
  return new TextEncoder().encode(str).length
}

function maybeTruncateContent(content: string, limit: number) {
  if (bytes(content) <= limit) return { text: content, truncated: false }
  // Keep head and tail, drop middle
  const half = Math.max(0, Math.floor(limit / 2))
  const head = content.slice(0, half)
  const tail = content.slice(-half)
  const marker = "\n/* ... truncated middle due to size limits ... */\n"
  const combined = head + marker + tail
  return { text: combined, truncated: true }
}

async function ghGetContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  // contents API
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    {
      headers,
      cache: "no-store",
    },
  )
  if (!res.ok) {
    const msg = await res.text().catch(() => "")
    throw new Error(`GitHub content error ${res.status}: ${msg}`)
  }
  const json: any = await res.json()
  if (json?.content && json?.encoding === "base64") {
    const raw = Buffer.from(json.content, "base64").toString("utf-8")
    return raw
  }
  // Fallback attempt with raw endpoint (in case of LFS or others)
  const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, {
    headers,
    cache: "no-store",
  })
  if (!rawRes.ok) throw new Error(`Failed to fetch raw content for ${path}`)
  return await rawRes.text()
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AnalyzeBody

  try {
    let files: { path: string; content: string }[] = []
    let truncatedAny = false

    if (body.mode === "snippet") {
      files = (body.files || []).slice(0, MAX_FILES).map((f) => {
        const { text, truncated } = maybeTruncateContent(f.content ?? "", MAX_FILE_BYTES)
        if (truncated) truncatedAny = true
        return { path: f.path || "snippet.ts", content: text }
      })
    } else if (body.mode === "github") {
      const paths = (body.paths || []).slice(0, MAX_FILES)
      for (const p of paths) {
        const raw = await ghGetContent(body.owner, body.repo, p, body.ref)
        const { text, truncated } = maybeTruncateContent(raw, MAX_FILE_BYTES)
        if (truncated) truncatedAny = true
        files.push({ path: p, content: text })
      }
    } else {
      return Response.json({ error: "Unsupported mode" } satisfies AnalyzeResponse, { status: 400 })
    }

    // Enforce global size cap
    let total = 0
    const bounded: { path: string; content: string }[] = []
    for (const f of files) {
      const sz = bytes(f.content)
      if (total + sz > MAX_TOTAL_BYTES) {
        // stop adding more files; indicate truncation
        truncatedAny = true
        break
      }
      total += sz
      bounded.push(f)
    }

    const header = `You are a senior code reviewer. Analyze the following files and provide a structured review in JSON format with the following categories(only give categories that are relevant, skip others):
1. Code Quality & Readability
2. Correctness / Logic
3. Security & Vulnerability
4. Performance & Optimization
5. Maintainability & Scalability
6. Documentation & Comments
7. Testing & Coverage
8. Standards & Conventions
9. Dependency Management
10. Security Compliance
11. Code Structure & Architecture
12. Reusability & Modularity

For each category, provide findings, severity (HIGH, MEDIUM, LOW), and specific suggestions with code examples where applicable.
`
    const bundle = bounded.map((f) => `===== FILE: ${f.path} =====\n${f.content}\n`).join("\n")

    const prompt = `${header}\n${bundle}`

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            fileName: { type: "string" },
            categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  findings: { type: "array", items: { type: "string" } },
                  severity: { 
                    type: "string",
                    enum: ["HIGH", "MEDIUM", "LOW"]
                  },
                  suggestions: { 
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        codeExample: { type: "string" }
                      },
                      required: ["description"]
                    }
                  }
                },
                required: ["category", "findings", "severity"]
              }
            }
          },
          required: ["fileName", "categories"]
        }
      }
    })

    const text = response.text

    return Response.json({
      text,
      truncated: truncatedAny,
      totalBytes: total,
      fileCount: bounded.length,
    } satisfies AnalyzeResponse)
  } catch (e: any) {
    return Response.json({ error: e?.message || "Failed to analyze" } satisfies AnalyzeResponse, { status: 400 })
  }
}
