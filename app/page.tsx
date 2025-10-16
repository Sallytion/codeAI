import { Suspense } from "react"
import CodeReviewer from "@/components/reviewer/code-reviewer"

export default function Page() {
  return (
    <main className="min-h-dvh">
      <section className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-balance text-3xl font-semibold tracking-tight">AI Code Reviewer</h1>
          <p className="text-muted-foreground mt-2">
            Paste a code snippet or provide a GitHub link. Select files and get an AI-powered review with optimization
            and quality suggestions.
          </p>
        </header>
        <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
          <CodeReviewer />
        </Suspense>
      </section>
    </main>
  )
}
