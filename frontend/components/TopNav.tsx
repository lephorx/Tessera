"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGrid, LogOut, RefreshCw, Server, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { UpdateBanner } from "@/components/UpdateBanner"
import { cn } from "@/lib/utils"

// modern: the main places, as pills in the middle of the bar
const NAV = [
  { href: "/", label: "Servers", icon: LayoutGrid },
  { href: "/settings", label: "Settings", icon: Settings },
]

interface Props {
  user?: { id: number; username: string; is_admin?: boolean } | null
  onLogout?: () => void
}

export function TopNav({ user, onLogout }: Props) {
  const [updateCheck, setUpdateCheck] = useState(0)
  const pathname = usePathname()
  const section = pathname.startsWith("/settings") ? "/settings" : "/"
  // modern: the bar's edge only shows once content scrolls under it
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <>
      {/* modern: a translucent bar that content scrolls under */}
      <header
        data-scrolled={scrolled}
        className="border-b border-border bg-background modern:sticky modern:top-0 modern:z-40 modern:border-transparent modern:material modern:transition-[border-color,background-color] modern:duration-300 modern:[view-transition-name:site-nav] modern:data-[scrolled=false]:bg-background modern:data-[scrolled=true]:border-separator"
      >
        <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-6 modern:h-16 modern:gap-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight transition-opacity hover:opacity-80 modern:text-[17px] modern:font-extrabold"
          >
            <span className="modern:flex modern:size-8 modern:items-center modern:justify-center modern:rounded-[10px] modern:bg-linear-to-br modern:from-[#4f8dff] modern:to-[#1d4ed8] modern:shadow-[0_4px_14px_rgb(37_99_235/0.35),inset_0_0_0_1px_rgb(255_255_255/0.18)]">
              <Server className="size-4 text-primary modern:size-[17px] modern:text-white" />
            </span>
            <span>CSCM</span>
          </Link>

          {user && (
            <nav
              aria-label="Main"
              className="hidden flex-1 items-center justify-center gap-1 modern:sm:flex"
            >
              {NAV.map(({ href, label, icon: Icon }) => {
                const current = section === href
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-2 rounded-[12px] px-3.5 text-[14px] font-semibold transition-colors",
                      current
                        ? "bg-tint-bg text-tint"
                        : "text-muted-foreground hover:bg-fill hover:text-foreground"
                    )}
                  >
                    <Icon className="size-[18px]" />
                    {label}
                  </Link>
                )
              })}
            </nav>
          )}

          <div className="flex items-center gap-3 modern:gap-1">
            {user && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground modern:mr-2">
                <span
                  aria-hidden
                  className="hidden modern:flex modern:size-7 modern:items-center modern:justify-center modern:rounded-full modern:bg-fill modern:text-[12px] modern:font-semibold modern:text-foreground modern:uppercase"
                >
                  {user.username.slice(0, 1)}
                </span>
                <span>
                  <span className="modern:font-medium modern:text-foreground">
                    {user.username}
                  </span>
                  {user.is_admin && (
                    <span className="modern:ml-1.5 modern:rounded-full modern:bg-fill modern:px-1.5 modern:py-0.5 modern:text-[11px] modern:font-medium modern:text-muted-foreground">
                      <span className="modern:hidden"> · </span>admin
                    </span>
                  )}
                </span>
              </span>
            )}
            {user?.is_admin && (
              <Button
                variant="ghost"
                size="icon"
                className="modern:text-muted-foreground modern:hover:text-foreground"
                onClick={() => setUpdateCheck((n) => n + 1)}
                aria-label="Check for updates"
                title="Check for updates"
              >
                <RefreshCw className="size-4" />
              </Button>
            )}
            {user && (
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="modern:text-muted-foreground modern:hover:text-foreground modern:sm:hidden"
              >
                <Link href="/settings" aria-label="Settings" title="Settings">
                  <Settings className="size-4" />
                </Link>
              </Button>
            )}
            {onLogout && (
              <Button
                variant="ghost"
                size="icon"
                className="modern:text-muted-foreground modern:hover:text-foreground"
                onClick={onLogout}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="size-4" />
              </Button>
            )}
            {!user && !onLogout && (
              <span className="text-xs text-muted-foreground">
                Minecraft Server Manager
              </span>
            )}
          </div>
        </div>
      </header>
      {/* only admins can install updates */}
      {user?.is_admin && <UpdateBanner checkRequest={updateCheck} />}
    </>
  )
}
