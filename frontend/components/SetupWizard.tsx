"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  Check,
  Globe,
  Loader2,
  Lock,
  ExternalLink,
} from "lucide-react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Server } from "@/lib/types"
import { cn } from "@/lib/utils"

const PLAYIT_AGENT_WIZARD =
  "https://playit.gg/account/setup/wizard/new-account/docker/docker-name"
const REGIONS = [
  "Germany",
  "United Kingdom",
  "Sweden",
  "Poland",
  "Romania",
  "Europe",
  "Atlanta",
  "California",
  "Chicago",
  "Dallas",
  "Denver",
  "Miami",
  "New York",
  "Seattle",
  "North America",
  "India",
  "Japan",
  "Asia",
  "Brazil",
  "Chile",
  "Australia",
]

type Step = "mode" | "playit" | "agent" | "cloudflare"
const STEPS: Step[] = ["mode", "playit", "agent", "cloudflare"]
const STEP_TITLES: Record<Step, string> = {
  mode: "Access",
  playit: "Playit account",
  agent: "Playit agent",
  cloudflare: "Custom domain",
}

interface SettingsResponse {
  values: Record<string, string>
  secrets_set: Record<string, boolean>
  env_writable: boolean
  agent: { managed: boolean; running: boolean; source: string | null }
  setup: { completed: boolean; step: Step; mode: "public" | "local" | null }
}

interface Confirmation {
  title: string
  warnings: string[]
  destructive: boolean
  save: () => void
}

const isOff = (v: string | undefined) =>
  ["false", "0", "no", "off"].includes((v || "").toLowerCase())

// Follow the background move of DNS records after the domain changed
async function followDnsSync() {
  const id = toast.loading("Moving DNS records…")
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    let status
    try {
      status = await api.settings.dnsSync()
    } catch {
      continue
    }
    if (status.running) {
      if (status.total)
        toast.loading(
          `Moving DNS records… ${status.done} of ${status.total} servers`,
          { id }
        )
      continue
    }
    if (status.failed.length)
      toast.error(
        `DNS records of ${status.failed.join(", ")} could not be moved. Retry DNS on those servers.`,
        { id, duration: 15000 }
      )
    else
      toast.success(
        status.total
          ? `DNS records of ${status.total} server${status.total === 1 ? "" : "s"} are up to date`
          : "DNS settings applied",
        { id }
      )
    return
  }
  toast.dismiss(id)
}

interface Props {
  /** true right after account creation (full page); false inside /settings */
  firstRun: boolean
  onDone: () => void
}

// Connection setup after account creation. Every step is saved to the
// installation's .env as soon as the user continues, and the current step is
// stored on the server, so the wizard resumes where it was left. On the
// settings page it shows all settings as one form once something is
// configured; "Run setup again" switches back to the wizard.
export function SetupWizard({ firstRun, onDone }: Props) {
  const [loaded, setLoaded] = useState<SettingsResponse | null>(null)
  const [step, setStep] = useState<Step>("mode")
  const [wizard, setWizard] = useState(firstRun)
  const [saving, setSaving] = useState(false)

  // form state (secrets stay empty unless the user types a new one)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [subscription, setSubscription] = useState("free")
  const [region, setRegion] = useState("Germany")
  const [agentMode, setAgentMode] = useState<"managed" | "existing">("managed")
  const [agentName, setAgentName] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [cfEnabled, setCfEnabled] = useState(false)
  const [cfToken, setCfToken] = useState("")
  const [cfZone, setCfZone] = useState("")
  const [cfDomain, setCfDomain] = useState("")
  const [servers, setServers] = useState<Server[]>([])
  const [confirm, setConfirm] = useState<Confirmation | null>(null)

  useEffect(() => {
    api.servers
      .list()
      .then((res) => setServers(res?.servers ?? res ?? []))
      .catch(() => {})
    api.settings
      .get()
      .then((res: SettingsResponse) => {
        const v = res.values
        setLoaded(res)
        setStep(firstRun ? res.setup.step : "mode")
        const configured =
          !!v.PLAYIT_EMAIL ||
          !!v.CLOUDFLARE_ZONE_ID ||
          Object.values(res.secrets_set).some(Boolean)
        setWizard(firstRun || !configured)
        setEmail(v.PLAYIT_EMAIL ?? "")
        setSubscription(v.PLAYIT_SUBSCRIPTION || "free")
        setRegion(v.PLAYIT_REGION || "Germany")
        setAgentName(v.PLAYIT_AGENT ?? "")
        setAgentMode(
          res.secrets_set.PLAYIT_SECRET_KEY ||
            res.agent.managed ||
            !v.PLAYIT_AGENT
            ? "managed"
            : "existing"
        )
        setCfEnabled(
          (v.CLOUDFLARE_ENABLED || "false") !== "false" &&
            !!v.CLOUDFLARE_ZONE_ID
        )
        setCfZone(v.CLOUDFLARE_ZONE_ID ?? "")
        setCfDomain(v.CLOUDFLARE_BASE_DOMAIN ?? "")
      })
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Could not load settings"
        )
      )
  }, [firstRun])

  // after a section is saved from the settings form
  const saved = (what: string) => async () => {
    toast.success(`${what} saved`)
    setLoaded(await api.settings.get())
  }

  async function run(action: () => Promise<void>) {
    setSaving(true)
    try {
      await action()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  const goTo = (next: Step) => {
    setStep(next)
    api.setup.update({ step: next }).catch(() => {})
  }

  const finish = (mode: "public" | "local") =>
    run(async () => {
      await api.setup.update({ mode, completed: true, step: "mode" })
      toast.success(
        mode === "public"
          ? "Setup complete. New servers get a public address."
          : "Setup complete. Servers are reachable in your network."
      )
      onDone()
    })

  const saveAccount = (
    after: () => void | Promise<void> = () => goTo("agent")
  ) =>
    run(async () => {
      if (!email.trim()) throw new Error("Enter your Playit email.")
      if (!password && !loaded?.secrets_set.PLAYIT_PASSWORD)
        throw new Error("Enter your Playit password.")
      await api.settings.save({
        PLAYIT_EMAIL: email.trim(),
        PLAYIT_PASSWORD: password || null,
        PLAYIT_SUBSCRIPTION: subscription,
        PLAYIT_REGION: region,
      })
      await api.setup.update({ mode: "public" })
      setPassword("")
      await after()
    })

  const saveAgent = (
    after: () => void | Promise<void> = () => goTo("cloudflare")
  ) =>
    run(async () => {
      if (agentMode === "managed") {
        if (!secretKey && !loaded?.secrets_set.PLAYIT_SECRET_KEY)
          throw new Error("Paste the agent's SECRET_KEY.")
        await api.settings.save({
          PLAYIT_SECRET_KEY: secretKey || null,
          PLAYIT_AGENT: agentName.trim(),
        })
        await api.settings.startAgent()
      } else {
        await api.settings.save({ PLAYIT_AGENT: agentName.trim() })
        if (loaded?.agent.source === "cscm") await api.settings.stopAgent()
      }
      setSecretKey("")
      await after()
    })

  const saveCloudflare = (
    after: () => void | Promise<void> = () => finish("public")
  ) =>
    run(async () => {
      if (cfEnabled) {
        if (!cfZone.trim() || !cfDomain.trim())
          throw new Error("Enter the zone ID and base domain.")
        if (!cfToken && !loaded?.secrets_set.CLOUDFLARE_API_TOKEN)
          throw new Error("Enter a Cloudflare API token.")
      }
      const res = await api.settings.save({
        CLOUDFLARE_ENABLED: cfEnabled ? "auto" : "false",
        CLOUDFLARE_API_TOKEN: cfEnabled ? cfToken || null : null,
        CLOUDFLARE_ZONE_ID: cfEnabled ? cfZone.trim() : null,
        CLOUDFLARE_BASE_DOMAIN: cfEnabled ? cfDomain.trim() : null,
      })
      setCfToken("")
      await after()
      if (res?.dns_sync) followDnsSync()
    })

  if (!loaded) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const savedValues = loaded.values
  const savedDomain = savedValues.CLOUDFLARE_BASE_DOMAIN ?? ""
  const domainChanged = !!savedDomain && cfDomain.trim() !== savedDomain
  // what is still missing before the custom domain can be saved
  const cfMissing = cfEnabled
    ? [
        !cfToken &&
          !loaded.secrets_set.CLOUDFLARE_API_TOKEN &&
          "Cloudflare API token",
        !cfZone.trim() && "zone ID",
        !cfDomain.trim() && "base domain",
      ].filter((m): m is string => !!m)
    : []

  // the domain belongs to its own zone: changing it asks for the zone ID again
  const changeDomain = (value: string) => {
    setCfDomain(value)
    if (!savedDomain) return
    if (value.trim() === savedDomain)
      setCfZone(savedValues.CLOUDFLARE_ZONE_ID ?? "")
    else if (cfDomain.trim() === savedDomain) setCfZone("")
  }

  const publicServers = servers.filter(
    (s) => !s.local_only && (s.tunnels?.length ?? 0) > 0
  ).length
  const serverCount = `${publicServers} server${publicServers === 1 ? "" : "s"}`

  // what saving a section will do, shown before it is saved
  function playitWarnings(): string[] {
    const w: string[] = []
    const oldEmail = savedValues.PLAYIT_EMAIL ?? ""
    if (oldEmail && email.trim() !== oldEmail)
      w.push(
        `New tunnels are created in the Playit account ${email.trim()}. Existing tunnels stay in ${oldEmail} and keep working.`
      )
    else if (!oldEmail && email.trim())
      w.push(`CSCM creates tunnels with the Playit account ${email.trim()}.`)
    if (password)
      w.push("CSCM signs in to Playit with the new password from now on.")
    if ((savedValues.PLAYIT_SUBSCRIPTION || "free") !== subscription)
      w.push(
        `Tunnels created from now on use the ${subscription === "free" ? "free" : "premium"} plan. Existing tunnels don't change.`
      )
    if (
      subscription === "premium" &&
      (savedValues.PLAYIT_REGION || "Germany") !== region
    )
      w.push(
        `New tunnels are created in ${region}. Existing tunnels keep their region.`
      )
    if (w.length && loaded?.setup.mode === "local")
      w.push("Public addresses are turned on for new servers.")
    return w
  }

  function agentWarnings(): string[] {
    const w: string[] = []
    const agent = loaded!.agent
    if (agentMode === "managed") {
      if (secretKey)
        w.push(
          "CSCM restarts its Playit agent with the new SECRET_KEY. Your servers can't be reached from outside for a few seconds. If the key belongs to a different agent, existing tunnels only work again once they're assigned to it on playit.gg."
        )
      else if (agent.running && agent.source === "cscm")
        w.push(
          "CSCM restarts its Playit agent. Your servers can't be reached from outside for a few seconds."
        )
      else w.push("CSCM starts its own Playit agent on this device.")
    } else if (agent.source === "cscm") {
      w.push(
        "CSCM stops its own Playit agent. Keep your own agent running on this device, or nobody can reach your servers from outside."
      )
    }
    if ((savedValues.PLAYIT_AGENT ?? "") !== agentName.trim())
      w.push(
        agentName.trim()
          ? `New tunnels are assigned to the agent "${agentName.trim()}".`
          : "New tunnels are assigned to the first available agent."
      )
    return w
  }

  function cloudflareWarnings(): { warnings: string[]; destructive: boolean } {
    const wasOn =
      !isOff(savedValues.CLOUDFLARE_ENABLED || "false") &&
      !!savedValues.CLOUDFLARE_ZONE_ID
    const newDomain = cfDomain.trim()
    const none =
      publicServers === 0
        ? " No server has a public address yet, so no records change."
        : ""
    if (!wasOn && cfEnabled)
      return {
        destructive: false,
        warnings: [
          `CSCM creates DNS records on ${newDomain} for ${serverCount} with a public address. Players can then join with addresses like survival.${newDomain}; the Playit addresses keep working.${none}`,
        ],
      }
    if (wasOn && !cfEnabled)
      return {
        destructive: true,
        warnings: [
          `CSCM deletes the DNS records of ${serverCount} from ${savedDomain}. Those addresses stop working; players have to use the Playit addresses.${none}`,
        ],
      }
    if (!cfEnabled) return { destructive: false, warnings: [] }
    const w: string[] = []
    let destructive = false
    if (domainChanged) {
      destructive = true
      w.push(
        `Server addresses move from *.${savedDomain} to *.${newDomain}. CSCM creates the new records for ${serverCount} and deletes the old ones, so the old addresses stop working. Tell your players.${none}`
      )
    } else if (cfZone.trim() !== (savedValues.CLOUDFLARE_ZONE_ID ?? "")) {
      w.push(
        `CSCM creates the records of ${serverCount} in the new zone and deletes them from the old one.${none}`
      )
    }
    if (cfToken)
      w.push(
        domainChanged
          ? "The new API token must be allowed to edit DNS in the new zone; CSCM checks this before saving."
          : "Only the API token changes. Existing records stay as they are."
      )
    return { destructive, warnings: w }
  }

  // check, then ask before saving a section of the settings form
  function askToSave(
    title: string,
    { warnings, destructive }: { warnings: string[]; destructive: boolean },
    save: () => void
  ) {
    if (!warnings.length) {
      toast.info("Nothing changed")
      return
    }
    setConfirm({ title, warnings, destructive, save })
  }

  const stepIndex = STEPS.indexOf(step)
  const savedHint = (set: boolean) =>
    set ? "Saved. Leave empty to keep it." : ""

  const playitFields = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        CSCM creates the tunnels for your servers with your{" "}
        <a
          href="https://playit.gg"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          Playit.gg
        </a>{" "}
        account.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="playit-email">Playit email</Label>
        <Input
          id="playit-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="playit-password">Playit password</Label>
        <Input
          id="playit-password"
          type="password"
          autoComplete="new-password"
          placeholder={loaded.secrets_set.PLAYIT_PASSWORD ? "••••••••" : ""}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {savedHint(loaded.secrets_set.PLAYIT_PASSWORD)}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Subscription</Label>
        <div className="flex gap-2">
          {["free", "premium"].map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={subscription === s ? "default" : "outline"}
              onClick={() => setSubscription(s)}
            >
              {s === "free" ? "Free" : "Premium"}
            </Button>
          ))}
        </div>
      </div>
      {subscription === "premium" && (
        <div className="space-y-1.5">
          <Label htmlFor="playit-region">Region</Label>
          <select
            id="playit-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r} className="bg-background">
                {r}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )

  const agentFields = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A Playit agent on this device carries the traffic to your servers.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={agentMode === "managed" ? "default" : "outline"}
          onClick={() => setAgentMode("managed")}
        >
          Let CSCM run it
        </Button>
        <Button
          type="button"
          size="sm"
          variant={agentMode === "existing" ? "default" : "outline"}
          onClick={() => setAgentMode("existing")}
        >
          I already run one
        </Button>
      </div>

      {agentMode === "managed" ? (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Create or claim an agent in the{" "}
              <a
                href={PLAYIT_AGENT_WIZARD}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                Playit Docker setup <ExternalLink className="size-3" />
              </a>
              .
            </li>
            <li>Copy its SECRET_KEY and paste it below.</li>
          </ol>
          <div className="space-y-1.5">
            <Label htmlFor="playit-secret">Agent SECRET_KEY</Label>
            <Input
              id="playit-secret"
              type="password"
              autoComplete="off"
              placeholder={
                loaded.secrets_set.PLAYIT_SECRET_KEY ? "••••••••" : ""
              }
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {savedHint(loaded.secrets_set.PLAYIT_SECRET_KEY)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            On macOS and Windows, first enable{" "}
            <strong>
              Settings → Resources → Network → Enable host networking
            </strong>{" "}
            in Docker Desktop (4.34 or newer).
          </p>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="playit-agent">Agent name (optional)</Label>
          <Input
            id="playit-agent"
            placeholder="First available agent"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Keep that agent running on this device.
          </p>
        </div>
      )}
    </div>
  )

  const cloudflareFields = (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          <span className="block font-medium">
            Use my own domain (optional)
          </span>
          <span className="block text-xs text-muted-foreground">
            Give servers addresses like survival.example.com through Cloudflare.
            Otherwise players use the Playit address.
          </span>
        </span>
        <Switch checked={cfEnabled} onCheckedChange={setCfEnabled} />
      </label>
      {cfEnabled && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="cf-token">Cloudflare API token</Label>
            <Input
              id="cf-token"
              type="password"
              autoComplete="off"
              placeholder={
                loaded.secrets_set.CLOUDFLARE_API_TOKEN ? "••••••••" : ""
              }
              value={cfToken}
              onChange={(e) => setCfToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {savedHint(loaded.secrets_set.CLOUDFLARE_API_TOKEN) ||
                "Needs permission to edit DNS for your zone."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-zone">Zone ID</Label>
            <Input
              id="cf-zone"
              placeholder={
                domainChanged ? `Zone ID of ${cfDomain.trim()}` : undefined
              }
              value={cfZone}
              onChange={(e) => setCfZone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-domain">Base domain</Label>
            <Input
              id="cf-domain"
              placeholder="example.com"
              value={cfDomain}
              onChange={(e) => changeDomain(e.target.value)}
            />
          </div>
          {cfMissing.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {domainChanged && !cfZone.trim()
                ? `Enter the zone ID of ${cfDomain.trim() || "the new domain"}${cfMissing.length > 1 ? ` and the ${cfMissing.filter((m) => m !== "zone ID").join(" and ")}` : ""} to save.`
                : `Enter the ${cfMissing.join(", ")} to save.`}
            </p>
          )}
        </>
      )}
    </div>
  )

  const envWarning = !loaded.env_writable && (
    <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      CSCM can&apos;t write to <code>.env</code> in this installation. Update
      CSCM, or add the values to <code>.env</code> by hand and run{" "}
      <code>docker compose restart api</code>.
    </p>
  )

  if (!wizard) {
    const sections = [
      {
        title: "Playit account",
        fields: playitFields,
        blocked: false,
        save: () =>
          askToSave(
            "Save Playit account?",
            {
              warnings: playitWarnings(),
              destructive:
                !!savedValues.PLAYIT_EMAIL &&
                email.trim() !== savedValues.PLAYIT_EMAIL,
            },
            () => saveAccount(saved("Playit account"))
          ),
      },
      {
        title: "Playit agent",
        fields: agentFields,
        blocked: false,
        save: () =>
          askToSave(
            "Save agent settings?",
            {
              warnings: agentWarnings(),
              destructive:
                agentMode === "existing" && loaded.agent.source === "cscm",
            },
            () => saveAgent(saved("Agent settings"))
          ),
      },
      {
        title: "Custom domain",
        fields: cloudflareFields,
        blocked: cfMissing.length > 0,
        save: () =>
          askToSave("Save custom domain?", cloudflareWarnings(), () =>
            saveCloudflare(saved("Custom domain"))
          ),
      },
    ]
    return (
      <div>
        <p className="text-sm text-muted-foreground">
          {loaded.setup.mode === "local"
            ? "CSCM is set to local network only. Saving a Playit account turns public addresses on."
            : "Each section is saved to your installation's .env on its own."}
        </p>
        {envWarning}
        <div className="mt-8 space-y-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-lg border border-border p-6"
            >
              <h2 className="mb-4 text-sm font-semibold">{section.title}</h2>
              {section.fields}
              <div className="mt-5 flex justify-end">
                <Button
                  size="sm"
                  disabled={saving || section.blocked}
                  onClick={section.save}
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  Save
                </Button>
              </div>
            </section>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              setStep("mode")
              setWizard(true)
            }}
          >
            Run setup again
          </Button>
          <Button onClick={onDone}>Done</Button>
        </div>

        <Dialog
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle
                  className={cn(
                    "size-4",
                    confirm?.destructive ? "text-destructive" : "text-amber-500"
                  )}
                />
                {confirm?.title}
              </DialogTitle>
              <DialogDescription>This is what happens next:</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {confirm?.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={confirm?.destructive ? "destructive" : "default"}
                onClick={() => {
                  confirm?.save()
                  setConfirm(null)
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className={firstRun ? "mx-auto w-full max-w-xl px-6 py-10" : ""}>
      {firstRun && (
        <>
          <p className="text-xs tracking-widest text-muted-foreground uppercase">
            Welcome to CSCM
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Finish setting up
          </h1>
        </>
      )}
      <p className={cn("text-sm text-muted-foreground", firstRun && "mt-2")}>
        Settings are saved to your installation&apos;s <code>.env</code> as you
        go. You can change them later in Settings, or edit <code>.env</code>{" "}
        directly.
      </p>

      {envWarning}

      {/* progress */}
      <ol className="mt-8 flex gap-2">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(
              "h-1 flex-1 rounded-full bg-border",
              i <= stepIndex && "bg-primary"
            )}
            title={STEP_TITLES[s]}
          />
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        Step {stepIndex + 1} of {STEPS.length}: {STEP_TITLES[step]}
      </p>

      <div className="mt-6 rounded-lg border border-border p-6">
        {step === "mode" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Who should be able to join your Minecraft servers?
            </p>
            <button
              type="button"
              onClick={() => goTo("playit")}
              className="flex w-full items-start gap-3 rounded-md border border-border p-4 text-left transition-colors hover:border-primary"
            >
              <Globe className="mt-0.5 size-4 text-primary" />
              <span>
                <span className="block text-sm font-medium">
                  Anyone, over the internet
                </span>
                <span className="block text-xs text-muted-foreground">
                  Uses a free Playit.gg account, no router setup needed.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => finish("local")}
              className="flex w-full items-start gap-3 rounded-md border border-border p-4 text-left transition-colors hover:border-primary"
            >
              <Lock className="mt-0.5 size-4 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">
                  Only my local network
                </span>
                <span className="block text-xs text-muted-foreground">
                  Nothing else to set up. You can switch later.
                </span>
              </span>
            </button>
          </div>
        )}

        {step === "playit" && playitFields}

        {step === "agent" && agentFields}

        {step === "cloudflare" && cloudflareFields}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div>
          {stepIndex > 0 && (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => goTo(STEPS[stepIndex - 1])}
            >
              Back
            </Button>
          )}
          {!firstRun && stepIndex === 0 && (
            <Button variant="ghost" onClick={onDone}>
              Close
            </Button>
          )}
        </div>
        {step !== "mode" && (
          <Button
            disabled={saving || (step === "cloudflare" && cfMissing.length > 0)}
            onClick={() =>
              step === "playit"
                ? saveAccount()
                : step === "agent"
                  ? saveAgent()
                  : saveCloudflare()
            }
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              step === "cloudflare" && <Check className="size-4" />
            )}
            {step === "cloudflare" ? "Finish" : "Continue"}
          </Button>
        )}
      </div>
    </div>
  )
}
