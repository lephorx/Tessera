"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { api } from "@/lib/api"
import type { CreateServerPayload } from "@/lib/types"

export type CreationStage = "submitting" | "starting" | "ready" | "error"

export interface CreationTask {
  serverId: number
  name: string
  stage: CreationStage
  progress: number
  step: string
}

const POLL_MS = 2000
const SUBMIT_TICK_MS = 400
// Progress shown while the create request is in flight, before we have a
// real server to poll — capped low so it never has to jump backwards once
// the backend reports real (and possibly lower) progress.
const SUBMIT_PROGRESS_CAP = 15

// Single source of truth for "creating a server". It lives at module level,
// not in a component, so it survives moving between pages: start a server
// on /servers/new, go back to the dashboard, and the progress carries on
// in the floating notification there.
let task: CreationTask | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()
const createdCallbacks = new Set<() => void>()

function setTask(
  next:
    | CreationTask
    | null
    | ((prev: CreationTask | null) => CreationTask | null)
) {
  task = typeof next === "function" ? next(task) : next
  listeners.forEach((listener) => listener())
}

function stopTimers() {
  if (pollTimer) clearInterval(pollTimer)
  if (tickTimer) clearInterval(tickTimer)
  pollTimer = null
  tickTimer = null
}

function pollProgress(serverId: number) {
  const poll = async () => {
    try {
      const res = await api.servers.progress(serverId)
      const percent: number = res?.percent ?? 0
      const step: string = res?.step ?? ""
      const status: string = res?.status ?? ""
      const done = status === "completed" || status === "done" || percent >= 100
      const failed = status === "failed" || status === "error"

      setTask((prev) => {
        if (!prev || prev.serverId !== serverId) return prev
        return {
          ...prev,
          // Progress only ever moves forward, even if a poll returns a
          // lower number than what's already on screen.
          progress: done ? 100 : Math.max(prev.progress, percent),
          step: (failed && res?.message) || step || prev.step,
          stage: done ? "ready" : failed ? "error" : "starting",
        }
      })

      if (done || failed) {
        stopTimers()
        if (done) createdCallbacks.forEach((callback) => callback())
      }
    } catch {
      // transient network hiccup — keep polling
    }
  }

  void poll()
  pollTimer = setInterval(poll, POLL_MS)
}

async function start(payload: CreateServerPayload) {
  stopTimers()
  setTask({
    serverId: 0,
    name: payload.name,
    stage: "submitting",
    progress: 5,
    step: "",
  })

  tickTimer = setInterval(() => {
    setTask((prev) =>
      prev && prev.stage === "submitting" && prev.progress < SUBMIT_PROGRESS_CAP
        ? { ...prev, progress: prev.progress + 1 }
        : prev
    )
  }, SUBMIT_TICK_MS)

  try {
    const result = await api.servers.create(payload)
    const serverId: number = result?.server_id ?? result?.data?.server_id ?? 0

    if (tickTimer) clearInterval(tickTimer)
    setTask({
      serverId,
      name: payload.name,
      stage: "starting",
      progress: SUBMIT_PROGRESS_CAP,
      step: "",
    })
    pollProgress(serverId)
    return serverId
  } catch (err) {
    stopTimers()
    setTask(null)
    throw err
  }
}

function dismiss() {
  stopTimers()
  setTask(null)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useServerCreation(onServerCreated?: () => void) {
  const current = useSyncExternalStore(
    subscribe,
    () => task,
    () => null
  )

  // tell this page when a server finishes, for as long as it's mounted
  const callback = useRef(onServerCreated)
  useEffect(() => {
    callback.current = onServerCreated
  }, [onServerCreated])
  useEffect(() => {
    const notify = () => callback.current?.()
    createdCallbacks.add(notify)
    return () => {
      createdCallbacks.delete(notify)
    }
  }, [])

  const startTask = useCallback(
    (payload: CreateServerPayload) => start(payload),
    []
  )
  const dismissTask = useCallback(() => dismiss(), [])

  return { task: current, start: startTask, dismiss: dismissTask }
}
