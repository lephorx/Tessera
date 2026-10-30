"use client"

import * as React from "react"
import { flushSync } from "react-dom"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// the latest tab switch; an older one finishing must not end a newer one
let tabSwitchId = 0

function Tabs({
  className,
  orientation = "horizontal",
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const rootRef = React.useRef<HTMLDivElement>(null)

  // remember which way the selection moved, so the new panel can slide in
  // from that side (modern design, see globals.css)
  const handleChange = React.useCallback(
    (next: string) => {
      const root = rootRef.current
      if (root) {
        const triggers = [
          ...root.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]'),
        ]
        const from = triggers.findIndex((t) => t.dataset.state === "active")
        const to = triggers.findIndex(
          (t) => t.getAttribute("data-value") === next
        )
        root.dataset.direction =
          from === -1 || to === -1 || to === from
            ? "none"
            : to > from
              ? "forward"
              : "back"
      }

      // modern: the open panel slides out and the new one in, through a
      // view transition (see globals.css). Only for controlled tabs that
      // render the change right away.
      const html = document.documentElement
      if (
        onValueChange &&
        root?.dataset.direction !== "none" &&
        html.dataset.design === "modern" &&
        document.startViewTransition &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        const id = ++tabSwitchId
        html.dataset.tabSwitch = root?.dataset.direction ?? "across"
        const transition = document.startViewTransition(() =>
          flushSync(() => onValueChange(next))
        )
        transition.finished.finally(() => {
          if (id === tabSwitchId) delete html.dataset.tabSwitch
        })
        return
      }
      onValueChange?.(next)
    },
    [onValueChange]
  )

  return (
    <TabsPrimitive.Root
      ref={rootRef}
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      onValueChange={handleChange}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
      // modern draws both as a segmented control
      design: {
        modern:
          "modern:h-11 modern:w-fit modern:max-w-full modern:justify-start modern:gap-1 modern:overflow-x-auto modern:rounded-[16px] modern:border modern:border-border modern:bg-card modern:p-1 modern:shadow-surface modern:[scrollbar-width:none]",
      },
    },
    defaultVariants: {
      variant: "default",
      design: "modern",
    },
  }
)

/** modern: keeps a pill under the active trigger and slides it along */
function useTabsIndicator(
  listRef: React.RefObject<HTMLDivElement | null>,
  indicatorRef: React.RefObject<HTMLSpanElement | null>
) {
  React.useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    let first = true
    let current: HTMLElement | null = null
    let running: Animation | null = null

    /** where the pill is on screen right now, mid-animation included */
    const presented = () => {
      const listBox = list.getBoundingClientRect()
      const box = indicator.getBoundingClientRect()
      return {
        x: box.left - listBox.left - list.clientLeft + list.scrollLeft,
        width: box.width,
      }
    }

    const place = () => {
      const active = list.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]'
      )
      if (!active) {
        indicator.style.opacity = "0"
        return
      }
      const x = active.offsetLeft
      const y = active.offsetTop
      const width = active.offsetWidth
      const moved = !first && current !== null && active !== current
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
      // read the starting point before anything changes
      const from = moved && !calm ? presented() : null

      if (moved || first) {
        running?.cancel()
        running = null
      }
      indicator.style.opacity = "1"
      indicator.style.width = `${width}px`
      indicator.style.height = `${active.offsetHeight}px`
      indicator.style.transform = `translate(${x}px, ${y}px)`

      if (from) {
        // stretch: the leading edge reaches the new tab first, so the pill
        // briefly spans both; then the trailing edge catches up
        const forward = x + width / 2 > from.x + from.width / 2
        const stretched = forward
          ? { x: from.x, width: x + width - from.x }
          : { x, width: from.x + from.width - x }
        running = indicator.animate(
          [
            {
              transform: `translate(${from.x}px, ${y}px)`,
              width: `${from.width}px`,
              easing: "cubic-bezier(0.45, 0, 0.55, 1)",
            },
            {
              transform: `translate(${stretched.x}px, ${y}px)`,
              width: `${stretched.width}px`,
              offset: 0.42,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            },
            { transform: `translate(${x}px, ${y}px)`, width: `${width}px` },
          ],
          { duration: 520 }
        )
        running.onfinish = () => (running = null)
      }

      if (moved) active.scrollIntoView({ block: "nearest", inline: "nearest" })
      current = active
      first = false
    }

    place()
    const mutations = new MutationObserver(place)
    mutations.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    })
    const sizes = new ResizeObserver(place)
    sizes.observe(list)
    list
      .querySelectorAll('[data-slot="tabs-trigger"]')
      .forEach((trigger) => sizes.observe(trigger))
    return () => {
      running?.cancel()
      mutations.disconnect()
      sizes.disconnect()
    }
  }, [listRef, indicatorRef])
}

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const indicatorRef = React.useRef<HTMLSpanElement>(null)
  useTabsIndicator(listRef, indicatorRef)

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), "relative", className)}
      {...props}
    >
      <span
        ref={indicatorRef}
        aria-hidden
        data-slot="tabs-indicator"
        className="pointer-events-none absolute top-0 left-0 hidden rounded-[12px] bg-tint-bg opacity-0 modern:block"
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-value={props.value}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "modern:z-[1] modern:h-full modern:flex-none modern:gap-2 modern:rounded-[12px] modern:border-0 modern:px-3.5 modern:text-[13px] modern:font-semibold modern:text-muted-foreground modern:transition-colors modern:duration-200 modern:after:hidden modern:hover:text-foreground modern:data-active:border-transparent! modern:data-active:bg-transparent! modern:data-active:text-tint! modern:data-active:shadow-none!",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
