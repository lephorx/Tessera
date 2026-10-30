import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { AboutPanel } from "@/components/AboutPanel"

export const metadata = { title: "About & privacy · Tessera" }

/** Public (no sign-in needed): linked from the sign-in page. */
export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-xl px-6 py-8">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Tessera
        </Link>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          About &amp; privacy
        </h1>
        <AboutPanel />
      </main>
    </div>
  )
}
