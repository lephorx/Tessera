"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  ArrowRight,
  Loader2,
  ShieldCheck,
  KeyRound,
  Copy,
  Check,
  Hash,
  User,
} from "lucide-react"
import { toast } from "sonner"

import { LogoMark } from "@/components/Logo"
import { TopNav } from "@/components/TopNav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { authApi } from "@/lib/api"
import type { AuthUser } from "@/hooks/useAuth"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type View = "setup-form" | "setup-qr" | "login-form"

interface Props {
  initialView: "setup-form" | "login-form"
  onLoginSuccess: (token: string, user: AuthUser) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}

/** a labelled input; modern puts the icon inside the field and keeps the
 *  label for screen readers only, like Modrinth's sign-in */
function Field({
  id,
  label,
  icon: Icon,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string
  label: string
  icon: LucideIcon
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="modern:sr-only">
        {label}
      </Label>
      <div className="relative">
        <Icon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 hidden size-[18px] -translate-y-1/2 text-muted-foreground modern:block"
        />
        <Input
          id={id}
          className="modern:h-11 modern:rounded-[12px] modern:border-border modern:bg-surface-2 modern:pl-11 modern:text-[15px] modern:font-medium modern:dark:bg-surface-2"
          {...props}
        />
      </div>
    </div>
  )
}

/** the full-width submit button; modern adds a trailing arrow */
function SubmitButton({
  busy,
  icon: Icon,
  children,
}: {
  busy: boolean
  icon?: LucideIcon
  children: React.ReactNode
}) {
  return (
    <Button
      type="submit"
      className="w-full modern:h-11 modern:rounded-[12px] modern:text-[15px] modern:font-bold"
      disabled={busy}
    >
      {busy ? (
        <Loader2 className="mr-2 size-4 animate-spin modern:mr-0" />
      ) : (
        Icon && <Icon className="mr-2 size-4 modern:hidden" />
      )}
      {children}
      {!busy && <ArrowRight className="hidden size-4 modern:block" />}
    </Button>
  )
}

export function AuthStatusError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="font-semibold">Tessera is unavailable</h1>
        <ErrorMessage message={message} />
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Setup form (first-time account creation)
// ---------------------------------------------------------------------------

interface SetupFormProps {
  onSuccess: (data: {
    setup_token: string
    totp_secret: string
    totp_uri: string
    qr_code_data_uri: string
  }) => void
}

function SetupForm({ onSuccess }: SetupFormProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }

    setSubmitting(true)
    try {
      const { ok, data } = await authApi.setup(username, password)
      if (!ok) {
        setError(data.error ?? "Setup failed.")
        return
      }
      onSuccess({
        setup_token: data.setup_token,
        totp_secret: data.totp_secret,
        totp_uri: data.totp_uri,
        qr_code_data_uri: data.qr_code_data_uri,
      })
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        id="setup-username"
        label="Username"
        icon={User}
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        required
        minLength={3}
      />
      <Field
        id="setup-password"
        label="Password"
        icon={KeyRound}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (at least 12 characters)"
        required
        minLength={12}
      />
      <Field
        id="setup-confirm"
        label="Confirm password"
        icon={KeyRound}
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Repeat password"
        required
      />

      {error && <ErrorMessage message={error} />}

      <SubmitButton busy={submitting}>
        {submitting ? "Preparing authenticator…" : "Continue to authenticator"}
      </SubmitButton>
    </form>
  )
}

// ---------------------------------------------------------------------------
// QR code / TOTP display
// ---------------------------------------------------------------------------

interface QrViewProps {
  qrCodeDataUri: string
  totpSecret: string
  setupToken: string
  onVerified: (token: string, user: AuthUser) => void
  onStartOver: () => void
}

function QrView({
  qrCodeDataUri,
  totpSecret,
  setupToken,
  onVerified,
  onStartOver,
}: QrViewProps) {
  const [copied, setCopied] = useState(false)
  const [otp, setOtp] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function copySecret() {
    navigator.clipboard.writeText(totpSecret).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      const { ok, data } = await authApi.verifySetup(setupToken, otp)
      if (!ok) {
        setError(data.error ?? "Could not verify the code.")
        return
      }
      toast.success("Administrator account created")
      onVerified(data.token, data.user)
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Scan the QR code with your authenticator app (Google Authenticator,
        Authy, 1Password, etc.) or enter the secret manually.
      </p>

      <div className="flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrCodeDataUri}
          alt="TOTP QR code"
          className="size-48 rounded-lg border border-border bg-white p-2"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Manual secret</Label>
        <div className="flex gap-2">
          <Input
            value={totpSecret}
            readOnly
            className="font-mono text-xs tracking-widest"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copySecret}
            aria-label="Copy secret"
          >
            {copied ? (
              <Check className="size-4 text-green-500" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <form onSubmit={handleVerify} className="space-y-4">
        <Field
          id="setup-otp"
          label="One-time code"
          icon={Hash}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          placeholder="6-digit code"
          minLength={6}
          maxLength={6}
          pattern="[0-9]{6}"
          required
        />
        {error && <ErrorMessage message={error} />}
        <SubmitButton busy={submitting} icon={KeyRound}>
          Verify and create account
        </SubmitButton>
      </form>
      <Button
        type="button"
        variant="ghost"
        className="w-full modern:h-auto modern:py-0 modern:font-semibold modern:text-tint modern:hover:bg-transparent modern:hover:text-tint/80"
        onClick={onStartOver}
      >
        Start over
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

interface LoginFormProps {
  onLoginSuccess: (token: string, user: AuthUser) => void
}

function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      const { ok, data } = await authApi.login(username, password, otp)
      if (!ok) {
        setError(data.error ?? "Login failed.")
        return
      }
      toast.success(`Welcome, ${data.user.username}!`)
      onLoginSuccess(data.token, data.user)
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        id="login-username"
        label="Username"
        icon={User}
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        required
      />
      <Field
        id="login-password"
        label="Password"
        icon={KeyRound}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      <Field
        id="login-otp"
        label="One-time code"
        icon={ShieldCheck}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
        placeholder="6-digit code from your authenticator"
        maxLength={6}
        required
      />

      {error && <ErrorMessage message={error} />}

      <SubmitButton busy={submitting} icon={ShieldCheck}>
        {submitting ? "Signing in…" : "Sign in"}
      </SubmitButton>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Main AuthPage
// ---------------------------------------------------------------------------

export function AuthPage({
  initialView,
  onLoginSuccess,
}: Props) {
  const [view, setView] = useState<View>(initialView)
  const [totpData, setTotpData] = useState<{
    setup_token: string
    totp_secret: string
    qr_code_data_uri: string
  } | null>(null)

  function handleSetupSuccess(data: {
    setup_token: string
    totp_secret: string
    totp_uri: string
    qr_code_data_uri: string
  }) {
    setTotpData({
      setup_token: data.setup_token,
      totp_secret: data.totp_secret,
      qr_code_data_uri: data.qr_code_data_uri,
    })
    setView("setup-qr")
  }

  const titles: Record<View, { heading: string; modern: string; sub: string }> =
    {
      "setup-form": {
        heading: "Create administrator account",
        modern: "Welcome to Tessera",
        sub: "First-time setup — this can only be done once.",
      },
      "setup-qr": {
        heading: "Set up authenticator",
        modern: "Set up your authenticator",
        sub: "Scan the QR code, then enter one code to finish registration.",
      },
      "login-form": {
        heading: "Sign in",
        modern: "Sign into Tessera",
        sub: "Enter your credentials and one-time code.",
      },
    }

  const { heading, modern, sub } = titles[view]

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* modern: the site bar on top, like every other page */}
      <div className="hidden modern:contents">
        <TopNav />
      </div>

      <main className="flex flex-1 items-center justify-center px-4 modern:py-16">
        <div className="enter w-full max-w-sm space-y-6 modern:max-w-[480px]">
          {/* Brand (classic; modern has it in the bar) */}
          <div className="flex flex-col items-center gap-2 text-center modern:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-[#8a8aff] to-[#4b4be0] shadow-[0_4px_14px_rgb(91_91_240/0.35),inset_0_0_0_1px_rgb(255_255_255/0.18)]">
              <LogoMark className="size-6 text-white" />
            </div>
            <span className="text-lg font-extrabold tracking-tight">tessera</span>
          </div>

          {/* Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm modern:p-7">
            <div className="mb-5 space-y-0.5 modern:mb-6 modern:space-y-1.5 modern:text-center">
              <h1 className="text-base font-semibold modern:text-[24px] modern:leading-tight modern:font-extrabold modern:tracking-[-0.015em]">
                <span className="modern:hidden">{heading}</span>
                <span className="hidden modern:inline">{modern}</span>
              </h1>
              <p
                className={
                  "text-sm text-muted-foreground" +
                  (view === "login-form" ? " modern:hidden" : "")
                }
              >
                {sub}
              </p>
            </div>

            <Separator className="mb-5 modern:hidden" />

            {view === "setup-form" && (
              <SetupForm onSuccess={handleSetupSuccess} />
            )}

            {view === "setup-qr" && totpData && (
              <QrView
                qrCodeDataUri={totpData.qr_code_data_uri}
                totpSecret={totpData.totp_secret}
                setupToken={totpData.setup_token}
                onVerified={onLoginSuccess}
                onStartOver={() => {
                  setTotpData(null)
                  setView("setup-form")
                }}
              />
            )}

            {view === "login-form" && (
              <LoginForm onLoginSuccess={onLoginSuccess} />
            )}
          </div>
        </div>
      </main>

      {/* modern: a quiet footer band */}
      <footer className="hidden border-t border-separator bg-card/60 modern:block">
        <div className="mx-auto flex max-w-screen-xl flex-col items-center justify-center gap-1.5 px-6 py-8 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-2 text-[15px] font-extrabold tracking-tight text-foreground">
            <LogoMark className="size-[18px] text-tint" />
            tessera
          </span>
          <span>Self-hosted Minecraft server manager</span>
        </div>
      </footer>
    </div>
  )
}
