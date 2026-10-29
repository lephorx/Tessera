"use client"

import { useEffect, useState } from "react"

// The backend reports few, uneven steps (deleting sits at "Stopping
// container" for most of the time), so the bar creeps towards 95% on its own
// between polls, never drops below the real value, and only runs to 100%
// once the work is really done.
export function useSmoothPercent(real: number, active: boolean) {
  const [shown, setShown] = useState(real)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      setShown((prev) =>
        real >= 100
          ? Math.min(100, prev + Math.max(5, (100 - prev) * 0.4))
          : Math.max(real, prev + (95 - prev) * 0.008)
      )
    }, 200)
    return () => clearInterval(id)
  }, [real, active])
  return Math.round(active ? Math.max(shown, real) : real)
}
