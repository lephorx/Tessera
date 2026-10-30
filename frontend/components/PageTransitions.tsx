"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"

/**
 * Modern design: moving between pages animates through the View
 * Transitions API. Only the page content moves (each page's <main> is
 * tagged `page-content`), the nav bar stays. Going deeper (a server, new
 * server, defaults) slides in from the right, going back from the left,
 * and moving sideways (servers / settings) fades up. Plain link clicks are
 * caught before Next's Link handles them, and the transition waits until
 * the new page is on screen. Anything unusual (new tab, modifier keys,
 * other sites, same page) is left alone.
 */

/** how deep a page sits: /servers 1, /servers/12 2 */
const depth = (path: string) => path.split("/").filter(Boolean).length

// set while <PageTransitions> is mounted; see navigate()
let transitionTo: ((href: string) => boolean) | null = null

/** go to a page from code (a button, after saving), with the same
 *  transition a link gets */
export function navigate(href: string, fallback: (href: string) => void) {
  if (!transitionTo?.(href)) fallback(href)
}

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
    /** runs the navigation inside a view transition; false if it can't */
    const go = (href: string) => {
      const root = document.documentElement
      if (root.dataset.design !== "modern" || !document.startViewTransition)
        return false
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false
      const url = new URL(href, location.href)
      if (url.pathname === location.pathname) return false

      const ready = new Promise<void>((resolve) => {
        arrived.current = resolve
        // never hold the page frozen if something goes wrong
        setTimeout(resolve, 1200)
      })
      const from = depth(location.pathname)
      const to = depth(url.pathname)
      root.dataset.navigating =
        to > from ? "forward" : to < from ? "back" : "across"
      // from now on pages don't play their own entrance on top of this one
      root.dataset.entered = "true"
      const transition = document.startViewTransition(() => {
        router.push(url.pathname + url.search + url.hash)
        return ready
      })
      transition.finished.finally(() => delete root.dataset.navigating)
      return true
    }
    transitionTo = go

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
      if (go(url.href)) e.preventDefault()
    }
    // capture: runs before Next's Link, which then sees defaultPrevented
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("click", onClick, true)
      if (transitionTo === go) transitionTo = null
    }
  }, [router])

  return null
}
