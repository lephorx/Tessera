"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"

/**
 * Modern design: moving between pages (servers, a server, settings)
 * cross-fades through the View Transitions API instead of cutting. Plain
 * link clicks are caught before Next's Link handles them, and the
 * transition waits until the new page is on screen. Anything unusual
 * (new tab, modifier keys, other sites, same page) is left alone.
 */
export function PageTransitions() {
  const router = useRouter()
  const pathname = usePathname()
  const arrived = useRef<(() => void) | null>(null)

  // the new route has rendered: let the transition animate to it
  useEffect(() => {
    arrived.current?.()
    arrived.current = null
  }, [pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return
      const root = document.documentElement
      if (root.dataset.design !== "modern" || !document.startViewTransition)
        return
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return

      const link = (e.target as Element | null)?.closest?.("a[href]")
      if (!(link instanceof HTMLAnchorElement)) return
      if (
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download")
      )
        return
      const url = new URL(link.href, location.href)
      if (url.origin !== location.origin || url.pathname.startsWith("/api"))
        return
      if (url.pathname === location.pathname) return

      e.preventDefault()
      const ready = new Promise<void>((resolve) => {
        arrived.current = resolve
        // never hold the page frozen if something goes wrong
        setTimeout(resolve, 1200)
      })
      root.dataset.navigating = "true"
      const transition = document.startViewTransition(() => {
        router.push(url.pathname + url.search + url.hash)
        return ready
      })
      transition.finished.finally(() => delete root.dataset.navigating)
    }
    // capture: runs before Next's Link, which then sees defaultPrevented
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [router])

  return null
}
