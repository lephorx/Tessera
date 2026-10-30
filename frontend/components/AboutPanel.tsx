"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { Switch } from "@/components/ui/switch"

const REPO_URL = "https://github.com/lephorx/Tessera"
export const MINECRAFT_EULA_URL = "https://aka.ms/MinecraftEULA"
export const MOJANG_DISCLAIMER =
  "Tessera is not an official Minecraft product. Not approved by or associated with Mojang or Microsoft."

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4 hover:text-foreground"
    >
      {children}
    </a>
  )
}

// Every connection Tessera (or the browser showing it) makes to the internet.
const CONNECTIONS: { who: string; what: React.ReactNode }[] = [
  {
    who: "GitHub (raw.githubusercontent.com)",
    what: "Update check about once an hour, unless turned off below. Updating runs git pull from GitHub and rebuilds the Docker images.",
  },
  {
    who: "Mojang API (api.mojang.com)",
    what: "Looks up a player's UUID when you add a name to a player list.",
  },
  {
    who: "launchermeta.mojang.com",
    what: "Your browser loads the list of Minecraft versions.",
  },
  {
    who: "Fabric and Forge (meta.fabricmc.net, maven.minecraftforge.net, files.minecraftforge.net)",
    what: "The dashboard server loads loader version lists for the version picker.",
  },
  {
    who: "mc-heads.net",
    what: "Your browser loads player heads and skins (the player name or UUID is in the address).",
  },
  {
    who: "minecraft.wiki",
    what: "Your browser loads item icons for player inventories.",
  },
  {
    who: "Docker Hub (itzg images)",
    what: "Server images are downloaded from Docker Hub. When a server starts, the image downloads the server software (Mojang, Paper, Fabric, Forge, modpack files and similar).",
  },
  {
    who: "Playit.gg",
    what: "Only if you set it up: your Playit login and agent create public tunnels; player traffic then goes through Playit.",
  },
  {
    who: "Cloudflare",
    what: "Only if you set it up: creates DNS records on your domain with your API token.",
  },
  {
    who: "Tessera Cloud",
    what: (
      <>
        Only if you link this machine: requests from the cloud dashboard or
        launcher go through it.{" "}
        <Ext href="https://tesseralauncher.com/privacy">Privacy policy</Ext>,{" "}
        <Ext href="https://tesseralauncher.com/terms">terms</Ext>.
      </>
    ),
  },
]

/** Admins can turn the automatic update check off (CSCM_UPDATE_CHECK in .env). */
function UpdateCheckToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        const v = String(s?.values?.CSCM_UPDATE_CHECK ?? "").toLowerCase()
        setEnabled(!["0", "false", "no", "off"].includes(v))
      })
      .catch(() => {})
  }, [])

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      await api.settings.save({ CSCM_UPDATE_CHECK: next ? "1" : "0" })
      setEnabled(next)
      toast.success(
        next ? "Automatic update check on" : "Automatic update check off"
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  if (enabled === null) return null
  return (
    <div className="mt-4 flex items-start justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <label
          htmlFor="update-check"
          className="cursor-pointer text-sm font-medium"
        >
          Check for updates automatically
        </label>
        <p className="text-xs text-muted-foreground">
          About once an hour, Tessera reads the latest version number from
          GitHub. &quot;Check for updates&quot; in the top bar still works when
          this is off. Same as <code>CSCM_UPDATE_CHECK=0</code> in{" "}
          <code>.env</code>.
        </p>
      </div>
      <Switch
        id="update-check"
        checked={enabled}
        disabled={busy}
        onCheckedChange={toggle}
      />
    </div>
  )
}

// What Tessera stores and which outside services it talks to. Shown in
// Settings and on the public /about page (linked from the sign-in page).
export function AboutPanel({ admin = false }: { admin?: boolean }) {
  return (
    <div className="space-y-6 text-sm">
      <section className="rounded-lg border border-border p-6">
        <h2 className="mb-2 text-sm font-semibold">Self-hosted</h2>
        <p className="text-muted-foreground">
          Tessera runs on this machine. Your data stays here; nothing is sent to
          the Tessera developers. Whoever runs this installation is responsible
          for it and for the data in it.
        </p>
      </section>

      <section className="rounded-lg border border-border p-6">
        <h2 className="mb-2 text-sm font-semibold">Stored on this machine</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            User accounts: username, hashed password and the two-factor
            (authenticator) secret.
          </li>
          <li>Servers: settings, worlds, files and backups.</li>
          <li>
            Player names and UUIDs on whitelists, operator, ban and default
            player lists.
          </li>
          <li>
            Logs: the dashboard logs requests with the caller&apos;s IP address,
            and Minecraft server logs contain the IP addresses of players who
            join.
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-border p-6">
        <h2 className="mb-2 text-sm font-semibold">
          Connections to the internet
        </h2>
        <ul className="space-y-2">
          {CONNECTIONS.map((c) => (
            <li key={c.who}>
              <p className="font-medium">{c.who}</p>
              <p className="text-xs text-muted-foreground">{c.what}</p>
            </li>
          ))}
        </ul>
        {admin && <UpdateCheckToggle />}
      </section>

      <section className="rounded-lg border border-border p-6">
        <h2 className="mb-2 text-sm font-semibold">Licenses</h2>
        <ul className="space-y-1 text-muted-foreground">
          <li>
            Minecraft servers run under the{" "}
            <Ext href={MINECRAFT_EULA_URL}>Minecraft EULA</Ext>, which you
            accept for every server you create. Bedrock servers also fall under
            the{" "}
            <Ext href="https://go.microsoft.com/fwlink/?LinkId=521839">
              Microsoft Privacy Policy
            </Ext>
            .
          </li>
          <li>
            Tessera is open source under the{" "}
            <Ext href={`${REPO_URL}/blob/main/LICENSE`}>MIT License</Ext>.
          </li>
          <li>
            <Ext href={`${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`}>
              Third-party notices
            </Ext>{" "}
            for the fonts, libraries and images it uses.
          </li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          {MOJANG_DISCLAIMER}
        </p>
      </section>
    </div>
  )
}
