"use client"

import { useState } from "react"
import Link from "next/link"
import { Server, LogOut, Settings, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { UpdateBanner } from "@/components/UpdateBanner"

interface Props {
  user?: { id: number; username: string; is_admin?: boolean } | null
  onLogout?: () => void
}

export function TopNav({ user, onLogout }: Props) {
  const [updateCheck, setUpdateCheck] = useState(0)

  return (
    <>
      {/* modern: a translucent bar that content scrolls under */}
      <header className="border-b border-border bg-background modern:sticky modern:top-0 modern:z-40 modern:border-separator modern:material">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-6 modern:h-13">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight transition-opacity hover:opacity-80 modern:text-[15px]"
          >
            <span className="modern:flex modern:size-7 modern:items-center modern:justify-center modern:rounded-[8px] modern:bg-linear-to-b modern:from-[#3b8cff] modern:to-[#0062e0] modern:shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.25)]">
              <Server className="size-4 text-primary modern:size-[15px] modern:text-white" />
            </span>
            <span>CSCM</span>
          </Link>

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
                className="modern:text-muted-foreground modern:hover:text-foreground"
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
