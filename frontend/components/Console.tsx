"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Send, Trash2, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Level = "all" | "error" | "warn" | "info"

// Java logs "[12:00:01] [Server thread/WARN]: …", Bedrock "… WARN] …"
function levelOf(line: string): Exclude<Level, "all"> {
  if (/\b(ERROR|FATAL|SEVERE)\]|\[(ERROR|FATAL|SEVERE)\b/.test(line))
    return "error"
  if (/\bWARN(ING)?\]|\[WARN(ING)?\b/.test(line)) return "warn"
  return "info"
}

const LEVEL_TEXT = {
  error: "modern:text-[#ff8a8a]",
  warn: "modern:text-[#ffc27a]",
  info: "",
} as const

interface Props {
  serverId: number
  isRunning: boolean
}

const POLL_INTERVAL = 3000
const MAX_LINES = 2000

export function Console({ serverId, isRunning }: Props) {
  const [logs, setLogs] = useState<string[]>([])
  const [command, setCommand] = useState("")
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  // modern: search and level filter for the output
  const [query, setQuery] = useState("")
  const [level, setLevel] = useState<Level>("all")
  const scrollRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef<number>(-1)
  // Pending lines are accumulated here and flushed on a timer to avoid
  // a state update (and full re-render) for every single SSE message.
  const pendingLinesRef = useRef<string[]>([])
  // Track whether the user is scrolled to the bottom so we don't snap
  // them back while they're reading older output.
  const atBottomRef = useRef(true)

  const flushPending = useCallback(() => {
    if (pendingLinesRef.current.length === 0) return
    const toAdd = pendingLinesRef.current.splice(0)
    setLogs((prev) => {
      const next = prev.concat(toAdd)
      return next.length > MAX_LINES
        ? next.slice(next.length - MAX_LINES)
        : next
    })
  }, [])

  const appendLine = useCallback((line: string) => {
    pendingLinesRef.current.push(line)
  }, [])

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.servers.logs(serverId)
      if (Array.isArray(res?.data)) {
        setLogs(res.data)
      }
    } catch {
      // silently fail on polling errors
    } finally {
      setLoading(false)
    }
  }, [serverId])

  const startPolling = useCallback(() => {
    if (intervalRef.current) return
    fetchLogs()
    intervalRef.current = setInterval(fetchLogs, POLL_INTERVAL)
  }, [fetchLogs])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Load history once, then switch to the live SSE stream. Fall back to
  // polling if the stream can't be opened or drops.
  useEffect(() => {
    let cancelled = false

    // Flush accumulated SSE lines at most 5× per second
    const flushTimer = setInterval(flushPending, 200)

    fetchLogs().then(() => {
      if (cancelled) return

      const es = new EventSource(api.console.streamUrl(serverId))
      eventSourceRef.current = es

      es.addEventListener("log", (e: MessageEvent) => {
        setLive(true)
        stopPolling()
        appendLine(e.data)
      })

      es.onerror = () => {
        setLive(false)
        es.close()
        eventSourceRef.current = null
        startPolling()
      }
    })

    return () => {
      cancelled = true
      clearInterval(flushTimer)
      flushPending() // drain any remaining lines on unmount
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      stopPolling()
    }
  }, [serverId, fetchLogs, appendLine, flushPending, startPolling, stopPolling])

  // Auto-scroll only when the user is already at (or very near) the bottom
  useEffect(() => {
    if (!atBottomRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  async function sendCommand(e: React.FormEvent) {
    e.preventDefault()
    const cmd = command.trim()
    if (!cmd) return

    // Basic validation: no shell metacharacters
    if (/[;&|`$]/.test(cmd)) {
      toast.error("Command contains invalid characters")
      return
    }

    setSending(true)
    try {
      await api.control.command(serverId, cmd)
      historyRef.current = [cmd, ...historyRef.current].slice(0, 100)
      historyIndexRef.current = -1
      setCommand("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send command")
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const history = historyRef.current
    if (e.key === "ArrowUp") {
      e.preventDefault()
      const next = Math.min(historyIndexRef.current + 1, history.length - 1)
      historyIndexRef.current = next
      if (history[next] !== undefined) setCommand(history[next])
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const next = historyIndexRef.current - 1
      historyIndexRef.current = next
      setCommand(next < 0 ? "" : (history[next] ?? ""))
    }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return logs
      .map((line, i) => ({ line, i, level: levelOf(line) }))
      .filter(
        (entry) =>
          (level === "all" || entry.level === level) &&
          (!needle || entry.line.toLowerCase().includes(needle))
      )
  }, [logs, query, level])
  const filtering = level !== "all" || query.trim() !== ""

  return (
    <div className="flex flex-col modern:gap-3 modern:p-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 modern:border-0 modern:p-0">
        <div className="flex items-center gap-2 modern:gap-2.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase modern:text-[16px] modern:font-bold modern:tracking-[-0.01em] modern:text-foreground modern:normal-case">
            Console
          </span>
          <span
            className={cn(
              "flex items-center gap-1 text-[10px]",
              live ? "text-emerald-500" : "text-muted-foreground",
              "modern:h-5 modern:rounded-full modern:px-2 modern:text-[11px] modern:font-semibold",
              live
                ? "modern:bg-status-green/15 modern:text-status-green"
                : "modern:bg-surface-2"
            )}
          >
            <span
              className={`size-1.5 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-zinc-400"}`}
            />
            {live ? "Live" : "Polling"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLogs([])}
          aria-label="Clear console"
        >
          <Trash2 className="size-3.5" />
          Clear
        </Button>
      </div>

      {/* modern: find a line, or show one level only */}
      <div className="hidden flex-col gap-2 modern:flex">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search logs</span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logs"
            className="pl-9 modern:pl-9"
          />
        </label>
        <div
          role="radiogroup"
          aria-label="Show lines"
          className="flex items-center gap-1.5"
        >
          {(["all", "error", "warn", "info"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={level === value}
              onClick={() => setLevel(value)}
              className={cn(
                "h-7 rounded-[8px] border px-2.5 text-[12px] font-semibold capitalize transition-[background-color,color,border-color,scale] active:scale-95",
                level === value
                  ? "border-transparent bg-tint-bg text-tint"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {value}
            </button>
          ))}
          {filtering && (
            <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
              {shown.length} of {logs.length} lines
            </span>
          )}
        </div>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[420px] overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200 modern:rounded-[12px] modern:bg-[#121418] modern:text-[12.5px] modern:leading-[1.65] modern:text-[#d4d8de]"
        aria-live="polite"
        aria-label="Server console output"
      >
        {loading ? (
          <span className="text-zinc-500">Loading logs…</span>
        ) : logs.length === 0 ? (
          <span className="text-zinc-500">No output yet.</span>
        ) : shown.length === 0 ? (
          <span className="text-zinc-500">No lines match.</span>
        ) : (
          shown.map(({ line, i, level }) => (
            <div
              key={i}
              className={cn("break-all whitespace-pre-wrap", LEVEL_TEXT[level])}
            >
              {line}
            </div>
          ))
        )}
      </div>

      {/* Command input */}
      <form
        onSubmit={sendCommand}
        className="flex items-center gap-2 border-t border-border bg-zinc-950 px-4 py-2 modern:rounded-[12px] modern:border-0 modern:bg-[#121418] modern:py-1.5 modern:pr-1.5 modern:focus-within:ring-2 modern:focus-within:ring-ring/60"
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground select-none">
          &gt;
        </span>
        <Input
          className="flex-1 border-none bg-transparent font-mono text-xs text-zinc-200 shadow-none placeholder:text-zinc-600 focus-visible:ring-0 modern:bg-transparent! modern:px-1 modern:focus-visible:bg-transparent"
          placeholder={isRunning ? "Enter command…" : "Server is not running"}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isRunning || sending}
          autoComplete="off"
          spellCheck={false}
          aria-label="Console command input"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!isRunning || sending || !command.trim()}
          aria-label="Send command"
        >
          {sending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
        </Button>
      </form>
    </div>
  )
}
