"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// The signed-in user's own account; available to every user.
export function AccountPanel({ username }: { username: string }) {
  const [busy, setBusy] = useState(false)
  const [currentPw, setCurrentPw] = useState("")
  const [nextPw, setNextPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const changePassword = (e: React.FormEvent) => {
    e.preventDefault()
    run(async () => {
      if (nextPw !== confirmPw) throw new Error("The new passwords don't match")
      await api.users.changePassword(currentPw, nextPw)
      toast.success("Password changed")
      setCurrentPw("")
      setNextPw("")
      setConfirmPw("")
    })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Signed in as{" "}
        <span className="font-medium text-foreground">{username}</span>.
      </p>
      <section className="rounded-lg border border-border p-6">
        <h2 className="mb-4 text-sm font-semibold">Change your password</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pw-current">Current password</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={nextPw}
              onChange={(e) => setNextPw(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 12 characters.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">Repeat new password</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              type="submit"
              disabled={busy || !currentPw || !nextPw || !confirmPw}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Change password
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
