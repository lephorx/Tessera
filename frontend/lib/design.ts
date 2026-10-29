"use client"

import { useSyncExternalStore } from "react"

import { DESIGN_KEY, type Design } from "./designBoot"

// Two looks: "modern" (rounded, follows the device's light/dark setting)
// and "classic" (the original square, always-dark design). The choice is
// kept per browser and set on <html> as data-design before the first paint.

export type { Design }

declare global {
  interface Window {
    __cscmApplyDesign?: () => void
  }
}

export function setDesign(design: Design) {
  const apply = () => {
    localStorage.setItem(DESIGN_KEY, design)
    window.__cscmApplyDesign?.()
  }
  // cross-fade the whole page where the browser can, instead of a flash
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
  if (document.startViewTransition && !calm) document.startViewTransition(apply)
  else apply()
}

interface Look {
  design: Design
  dark: boolean
}

let cached: Look = { design: "modern", dark: true }

function read(): Look {
  const root = document.documentElement
  const design: Design =
    root.dataset.design === "classic" ? "classic" : "modern"
  const dark = root.classList.contains("dark")
  if (design !== cached.design || dark !== cached.dark)
    cached = { design, dark }
  return cached
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-design"],
  })
  return () => observer.disconnect()
}

const SERVER_LOOK: Look = { design: "modern", dark: true }

/** the current design and whether it's dark, kept in sync with <html> */
export function useLook(): Look {
  return useSyncExternalStore(subscribe, read, () => SERVER_LOOK)
}
