"use client"

import type React from "react"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

type ListFilesResponse = {
  owner: string
  repo: string
  ref: string
  rootPath?: string
  files: string[]
  error?: string
}

type ReviewSuggestion = {
  description: string
  codeExample?: string
}

type ReviewCategory = {
  category: string
  findings: string[]
  severity: "HIGH" | "MEDIUM" | "LOW"
  suggestions?: ReviewSuggestion[]
}

type ReviewResult = {
  fileName: string
  categories: ReviewCategory[]
}

type AnalyzeResponse = {
  text?: string
  error?: string
  truncated?: boolean
  totalBytes?: number
  fileCount?: number
  review?: ReviewResult
}

const fetcher = (url: string, opts?: RequestInit) =>
  fetch(url, { ...opts }).then(async (r) => {
    const data = await r.json()
    if (!r.ok) throw new Error(data?.error || "Request failed")
    return data
  })

export default function CodeReviewer() {
  const [mode, setMode] = useState<"snippet" | "github">("snippet")

  // Snippet state
  const [snippetFilename, setSnippetFilename] = useState<string>("snippet.ts")
  const [snippetContent, setSnippetContent] = useState<string>("")

  // GitHub state
  const [repoUrlInput, setRepoUrlInput] = useState<string>("")
  const [fetchKey, setFetchKey] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<string>("")

  // Analysis state
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewText, setReviewText] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [analysisMeta, setAnalysisMeta] = useState<{
    truncated?: boolean
    totalBytes?: number
    fileCount?: number
  } | null>(null)

  const {
    data: listData,
    error: listError,
    isLoading: listLoading,
    mutate: refetchFiles,
  } = useSWR<ListFilesResponse>(
    fetchKey ? [`/api/github/list-files`, fetchKey] : null,
    ([url, key]) =>
      fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
      }),
    { revalidateOnFocus: false },
  )

  const files = useMemo(() => {
    if (!listData?.files) return []
    const f = listData.files
    if (!filter.trim()) return f
    const q = filter.trim().toLowerCase()
    return f.filter((p) => p.toLowerCase().includes(q))
  }, [listData, filter])

  const allVisibleSelected = useMemo(() => {
    if (!files.length) return false
    return files.every((p) => !!selected[p])
  }, [files, selected])

  function toggleAllVisible() {
    const next = { ...selected }
    const val = !allVisibleSelected
    files.forEach((p) => {
      next[p] = val
    })
    setSelected(next)
  }

  async function onFetchFiles() {
    setReviewText(null)
    setReviewError(null)
    setSelected({})
    setAnalysisMeta(null)
    setFetchKey(JSON.stringify({ repoUrl: repoUrlInput }))
  }

  async function onAnalyzeSnippet(e: React.FormEvent) {
    e.preventDefault()
    setReviewLoading(true)
    setReviewText(null)
    setReviewError(null)
    setAnalysisMeta(null)
    try {
      const res: AnalyzeResponse = await fetcher("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "snippet",
          files: [{ path: snippetFilename || "snippet.ts", content: snippetContent }],
        }),
      })
      setReviewText(res.text ?? "")
      setAnalysisMeta({ truncated: res.truncated, totalBytes: res.totalBytes, fileCount: res.fileCount })
    } catch (err: any) {
      setReviewError(err?.message || "Failed to analyze")
    } finally {
      setReviewLoading(false)
    }
  }

  async function onAnalyzeGitHub() {
    if (!listData) return
    const chosen = Object.keys(selected).filter((p) => selected[p])
    if (chosen.length === 0) {
      setReviewError("Please select at least one file to review.")
      return
    }
    setReviewLoading(true)
    setReviewText(null)
    setReviewError(null)
    setAnalysisMeta(null)
    try {
      const res: AnalyzeResponse = await fetcher("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "github",
          owner: listData.owner,
          repo: listData.repo,
          ref: listData.ref,
          paths: chosen,
        }),
      })
      setReviewText(res.text ?? "")
      setAnalysisMeta({ truncated: res.truncated, totalBytes: res.totalBytes, fileCount: res.fileCount })
    } catch (err: any) {
      setReviewError(err?.message || "Failed to analyze")
    } finally {
      setReviewLoading(false)
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle className="text-pretty">Choose input</CardTitle>
            <CardDescription>Paste a snippet or fetch files from a GitHub repository.</CardDescription>
          </div>
          <div className="inline-flex items-center gap-2">
            <Button
              variant={mode === "snippet" ? "default" : "secondary"}
              onClick={() => setMode("snippet")}
              aria-pressed={mode === "snippet"}
            >
              Paste Snippet
            </Button>
            <Button
              variant={mode === "github" ? "default" : "secondary"}
              onClick={() => setMode("github")}
              aria-pressed={mode === "github"}
            >
              GitHub Repo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {mode === "snippet" ? (
            <form onSubmit={onAnalyzeSnippet} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="filename">Filename</Label>
                <Input
                  id="filename"
                  placeholder="e.g. utils/math.ts"
                  value={snippetFilename}
                  onChange={(e) => setSnippetFilename(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="snippet">Code Snippet</Label>
                <Textarea
                  id="snippet"
                  className="min-h-[240px]"
                  placeholder="Paste your code here..."
                  value={snippetContent}
                  onChange={(e) => setSnippetContent(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <p className="text-muted-foreground text-sm">
                  We’ll analyze for performance, correctness, security, readability, and architecture.
                </p>
                <Button type="submit" disabled={reviewLoading || !snippetContent.trim()}>
                  {reviewLoading ? "Analyzing…" : "Analyze Snippet"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="repoUrl">GitHub Link</Label>
                <Input
                  id="repoUrl"
                  placeholder="https://github.com/owner/repo or .../tree/branch"
                  value={repoUrlInput}
                  onChange={(e) => setRepoUrlInput(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button onClick={onFetchFiles} disabled={!repoUrlInput.trim() || listLoading}>
                    {listLoading ? "Fetching…" : "Fetch Files"}
                  </Button>
                </div>
              </div>

              {listError && <p className="text-destructive text-sm">Error: {listError.message}</p>}

              {listData?.files && (
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                      Repo:{" "}
                      <span className="font-medium text-foreground">
                        {listData.owner}/{listData.repo}
                      </span>
                      {" · "}Ref: <span className="font-medium text-foreground">{listData.ref}</span>
                      {" · "}Files: {listData.files.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Filter files..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="w-[220px]"
                      />
                      <Button variant="secondary" onClick={toggleAllVisible}>
                        {allVisibleSelected ? "Unselect Visible" : "Select Visible"}
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-md max-h-[360px] overflow-auto">
                    <ul className="divide-y">
                      {files.map((path) => {
                        const checked = !!selected[path]
                        return (
                          <li key={path} className="flex items-center gap-3 px-3 py-2">
                            <Checkbox
                              id={`cb-${path}`}
                              checked={checked}
                              onCheckedChange={(v) => {
                                setSelected((prev) => ({ ...prev, [path]: !!v }))
                              }}
                            />
                            <Label
                              htmlFor={`cb-${path}`}
                              className={cn(
                                "cursor-pointer truncate",
                                checked ? "text-foreground" : "text-muted-foreground",
                              )}
                              title={path}
                            >
                              {path}
                            </Label>
                          </li>
                        )
                      })}
                      {files.length === 0 && (
                        <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                          No files match your filter.
                        </li>
                      )}
                    </ul>
                  </div>

                  <div className="flex items-center justify-end">
                    <Button
                      onClick={onAnalyzeGitHub}
                      disabled={reviewLoading || Object.values(selected).every((v) => !v)}
                    >
                      {reviewLoading ? "Analyzing…" : "Review Selected Files"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review Result</CardTitle>
          <CardDescription>AI analysis output</CardDescription>
        </CardHeader>
        <CardContent className="prose prose-sm max-w-none dark:prose-invert">
          {reviewError && <p className="text-destructive">Error: {reviewError}</p>}
          {!reviewError && !reviewText && (
            <p className="text-muted-foreground">No analysis yet. Submit a snippet or select files to begin.</p>
          )}
          {!reviewError && reviewText && (
            <>
              {analysisMeta?.truncated && (
                <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                  Note: Input was large. Some files were truncated to fit model limits. Total bytes analyzed:{" "}
                  {analysisMeta.totalBytes} across {analysisMeta.fileCount} file(s).
                </div>
              )}
              {(() => {
                try {
                  const review = JSON.parse(reviewText) as ReviewResult;
                  return (
                    <div className="space-y-6">
                      <div className="border-b pb-4">
                        <h2 className="text-xl font-semibold mb-2">Review for: {review.fileName}</h2>
                      </div>
                      {review.categories.map((category, idx) => (
                        <div key={idx} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-medium">{category.category}</h3>
                            <span className={cn(
                              "px-2 py-1 rounded-full text-xs font-medium",
                              category.severity === "HIGH" ? "bg-red-100 text-red-800" :
                              category.severity === "MEDIUM" ? "bg-yellow-100 text-yellow-800" :
                              "bg-green-100 text-green-800"
                            )}>
                              {category.severity}
                            </span>
                          </div>
                          
                          <div className="space-y-2">
                            {category.findings.length > 0 && (
                              <>
                                <h4 className="font-medium text-sm text-gray-700">Findings:</h4>
                                <ul className="list-disc list-inside text-sm space-y-1 text-gray-600 pl-4">
                                  {category.findings.map((finding, fidx) => (
                                    <li key={fidx} className="text-pretty">{finding}</li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>

                          {category.suggestions && category.suggestions.length > 0 && (
                            <div className="space-y-2">
                              <h4 className="font-medium text-sm text-gray-700">Suggestions:</h4>
                              <div className="space-y-4">
                                {category.suggestions.map((suggestion, sidx) => (
                                  <div key={sidx} className="text-sm space-y-2">
                                    <p className="text-gray-600">{suggestion.description}</p>
                                    {suggestion.codeExample && (
                                      <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto">
                                        <code>{suggestion.codeExample}</code>
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                } catch (e) {
                  return <article className="whitespace-pre-wrap">{reviewText}</article>;
                }
              })()}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
