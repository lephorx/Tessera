"use client"

import { useState } from "react"
import Link from "next/link"
import { Server, LogOut, Settings, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { UpdateBanner } from "@/components/UpdateBanner"

interface Props {
  user?: { id: number; username: string } | null
  onLogout?: () => void
}

export function TopNav({ user, onLogout }: Props) {
  const [updateCheck, setUpdateCheck] = useState(0)

  return (
    <>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight transition-opacity hover:opacity-80"
          >
            <Server className="size-4 text-primary" />
            <span>CSCM</span>
          </Link>

          <div className="flex items-center gap-3">
            {user && (
              <span className="text-xs text-muted-foreground">
                {user.username}
              </span>
            )}
            {user && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setUpdateCheck((n) => n + 1)}
                aria-label="Check for updates"
                title="Check for updates"
              >
                <RefreshCw className="size-4" />
              </Button>
            )}
            {user && (
              <Button variant="ghost" size="icon" asChild>
                <Link href="/settings" aria-label="Settings" title="Settings">
                  <Settings className="size-4" />
                </Link>
              </Button>
            )}
            {onLogout && (
              <Button
                variant="ghost"
                size="icon"
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
      {/* only for signed-in users; the version API needs a login */}
      {user && <UpdateBanner checkRequest={updateCheck} />}
    </>
  )
}
