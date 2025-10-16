import type { NextRequest } from "next/server"

type ListFilesBody = { repoUrl: string }
type ListFilesResponse = {
  owner: string
  repo: string
  ref: string
  rootPath?: string
  files: string[]
  error?: string
}

const GH_API = "https://api.github.com"

function parseGitHubUrl(url: string): { owner: string; repo: string; ref?: string; path?: string } {
  try {
    const u = new URL(url)
    if (u.hostname !== "github.com") throw new Error("Only github.com links are supported")
    const parts = u.pathname.split("/").filter(Boolean) // [owner, repo, tree|blob?, ref?, ...path]
    if (parts.length < 2) throw new Error("Invalid repository URL")
    const [owner, repo] = parts
    if (parts[2] === "tree" || parts[2] === "blob") {
      const ref = parts[3]
      const path = parts.slice(4).join("/")
      return { owner, repo, ref, path }
    }
    return { owner, repo }
  } catch (e: any) {
    throw new Error(e?.message || "Invalid URL")
  }
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${GH_API}${path}`, { ...init, headers, cache: "no-store" })
  if (!res.ok) {
    const msg = await res.text().catch(() => "")
    throw new Error(`GitHub API error ${res.status}: ${msg}`)
  }
  return res.json() as Promise<T>
}

export async function POST(req: NextRequest) {
  const { repoUrl } = (await req.json()) as ListFilesBody
  if (!repoUrl) {
    return Response.json({ error: "repoUrl is required" } satisfies ListFilesResponse, { status: 400 })
  }

  try {
    const { owner, repo, ref: refMaybe, path: rootPath } = parseGitHubUrl(repoUrl)

    type RepoInfo = { default_branch: string }
    const repoInfo = await gh<RepoInfo>(`/repos/${owner}/${repo}`)
    const ref = refMaybe || repoInfo.default_branch

    // Use git trees API to list all files recursively
    type TreeResp = { truncated: boolean; tree: Array<{ path: string; type: "blob" | "tree" | string }> }
    const tree = await gh<TreeResp>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)

    let files = tree.tree.filter((t) => t.type === "blob").map((t) => t.path)

    if (rootPath && rootPath.length) {
      const prefix = rootPath.endsWith("/") ? rootPath : `${rootPath}/`
      files = files.filter((p) => p.startsWith(prefix)).map((p) => p)
    }

    // Optionally filter out large/binary file types by extension
    const skipExt = new Set([
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
      ".pdf",
      ".zip",
      ".gz",
      ".mp4",
      ".mp3",
      ".mov",
      ".ogg",
      ".ogv",
      ".webm",
      ".glb",
      ".gltf",
    ])
    files = files.filter((p) => {
      const dot = p.lastIndexOf(".")
      if (dot === -1) return true
      const ext = p.slice(dot).toLowerCase()
      return !skipExt.has(ext)
    })

    return Response.json({ owner, repo, ref, rootPath, files } satisfies ListFilesResponse)
  } catch (e: any) {
    return Response.json({ error: e?.message || "Failed to list files" } satisfies ListFilesResponse, { status: 400 })
  }
}
