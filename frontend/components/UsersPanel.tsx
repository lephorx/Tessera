"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface User {
  id: number
  username: string
  created_at: string
}

interface Enrollment {
  username: string
  setup_token: string
  totp_secret: string
  qr_code_data_uri: string
}

// Everyone who can sign in to this dashboard. All users have full access;
// new users get their own authenticator code, like the first account.
export function UsersPanel() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [removing, setRemoving] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)

  // add user
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [otp, setOtp] = useState("")

  // own password
  const [currentPw, setCurrentPw] = useState("")
  const [nextPw, setNextPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await api.users.list()
      setUsers(res.users)
      setCurrentId(res.current_user_id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load users")
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

  function closeAdd() {
    setAddOpen(false)
    setNewName("")
    setNewPassword("")
    setEnrollment(null)
    setOtp("")
  }

  const startAdd = (e: React.FormEvent) => {
    e.preventDefault()
    run(async () => {
      const res = await api.users.add(newName.trim(), newPassword)
      setEnrollment({ username: newName.trim(), ...res })
    })
  }

  const finishAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!enrollment) return
    run(async () => {
      await api.users.verify(enrollment.setup_token, otp.trim())
      toast.success(`${enrollment.username} can now sign in`)
      closeAdd()
      await load()
    })
  }

  const remove = () =>
    run(async () => {
      if (!removing) return
      await api.users.remove(removing.id)
      toast.success(`${removing.username} was removed`)
      setRemoving(null)
      await load()
    })

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

  if (!users) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Users</h2>
            <p className="text-xs text-muted-foreground">
              Everyone here can manage all servers and settings.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="size-3.5" />
            Add user
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {user.username}
                  {user.id === currentId && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      You
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Added {new Date(user.created_at).toLocaleDateString()}
                </p>
              </div>
              {user.id !== currentId && users.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${user.username}`}
                  title={`Remove ${user.username}`}
                  onClick={() => setRemoving(user)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

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

      {/* Add user */}
      <Dialog open={addOpen} onOpenChange={(open) => !open && closeAdd()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {enrollment ? `Set up ${enrollment.username}` : "Add user"}
            </DialogTitle>
          </DialogHeader>
          {!enrollment ? (
            <form onSubmit={startAdd} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-user">Username</Label>
                <Input
                  id="new-user"
                  autoComplete="off"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-user-pw">Password</Label>
                <Input
                  id="new-user-pw"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least 12 characters.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeAdd}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || newName.trim().length < 3 || !newPassword}
                >
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  Continue
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={finishAdd} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {enrollment.username} scans this code with an authenticator app,
                then enters the six-digit code below.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enrollment.qr_code_data_uri}
                alt="Authenticator QR code"
                className="mx-auto size-44 rounded-md bg-white p-2"
              />
              <p className="text-center font-mono text-[11px] break-all text-muted-foreground">
                {enrollment.totp_secret}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="new-user-otp">One-time code</Label>
                <Input
                  id="new-user-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeAdd}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || otp.length !== 6}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  Add user
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove user */}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {removing?.username}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            They are signed out right away and can&apos;t sign in again. Their
            servers and settings stay.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={remove}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
