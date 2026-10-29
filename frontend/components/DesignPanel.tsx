"use client"

import { Check } from "lucide-react"

import { setDesign, useLook, type Design } from "@/lib/design"
import { cn } from "@/lib/utils"

const OPTIONS: { value: Design; label: string; description: string }[] = [
  {
    value: "modern",
    label: "Modern",
    description:
      "Rounded and calm. Follows your device's light or dark setting.",
  },
  {
    value: "classic",
    label: "Classic",
    description: "The original look: square edges, always dark.",
  },
]

/** a tiny drawing of the dashboard in each look */
function Preview({ design }: { design: Design }) {
  if (design === "classic") {
    return (
      <div className="flex h-full flex-col gap-1.5 bg-[#09090b] p-2.5">
        <div className="h-2 w-10 bg-[#27272a]" />
        <div className="grid flex-1 grid-cols-2 gap-1.5">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="flex flex-col gap-1 border border-[#27272a] bg-[#18181b] p-1.5"
            >
              <div className="h-1.5 w-8 bg-[#3f3f46]" />
              <div className="mt-auto flex gap-1">
                <div className="h-2 flex-1 bg-[#059669]" />
                <div className="h-2 flex-1 bg-[#f59e0b]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="grid h-full grid-cols-2">
      {/* light and dark halves: it follows the device */}
      {[
        { bg: "#f2f2f7", card: "#ffffff", line: "#d1d1d6" },
        { bg: "#000000", card: "#1c1c1e", line: "#3a3a3c" },
      ].map((tone, i) => (
        <div
          key={i}
          className="flex flex-col gap-1.5 p-2.5"
          style={{ background: tone.bg }}
        >
          <div
            className="h-2 w-8 rounded-full"
            style={{ background: tone.line }}
          />
          <div
            className="flex flex-1 flex-col gap-1 rounded-[7px] p-1.5"
            style={{ background: tone.card }}
          >
            <div className="flex items-center gap-1">
              <div
                className="size-2.5 rounded-[3px]"
                style={{ background: tone.line }}
              />
              <div
                className="h-1.5 w-6 rounded-full"
                style={{ background: tone.line }}
              />
            </div>
            <div className="mt-auto h-2 rounded-full bg-[#34c759]/25" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function DesignPanel() {
  const { design } = useLook()

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Design</legend>
      <p className="text-xs text-muted-foreground">
        Saved in this browser. You can switch back at any time.
      </p>
      <div className="grid gap-3 pt-1 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = design === option.value
          return (
            <label
              key={option.value}
              className={cn(
                "lift group relative flex cursor-pointer flex-col overflow-hidden border border-border bg-card transition-[border-color,box-shadow]",
                "modern:active:scale-[0.98]",
                "modern:rounded-2xl modern:shadow-surface",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                selected
                  ? "border-primary ring-1 ring-primary modern:border-tint modern:ring-tint"
                  : "hover:border-foreground/30"
              )}
            >
              <input
                type="radio"
                name="design"
                value={option.value}
                checked={selected}
                onChange={() => setDesign(option.value)}
                className="sr-only"
              />
              <div className="aspect-[16/9] border-b border-border">
                <Preview design={option.value} />
              </div>
              <div className="flex items-start justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border",
                    selected &&
                      "border-primary bg-primary text-primary-foreground"
                  )}
                >
                  {selected && <Check className="size-3" strokeWidth={3} />}
                </span>
              </div>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
