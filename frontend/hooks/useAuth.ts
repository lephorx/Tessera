"use client"

import { useState, useEffect, useCallback } from "react"
import { authApi, saveToken, clearToken } from "@/lib/api"

export interface AuthUser {
  id: number
  username: string
  /** admins see every server and manage users and settings */
  is_admin?: boolean
}

export interface AuthState {
  loading: boolean
  statusError: string | null
  setupRequired: boolean
  authenticated: boolean
  user: AuthUser | null
}

// The last answer, kept for the whole visit: every page asks again, but a
// page opened later starts from this instead of a full-screen spinner,
// so moving between pages doesn't flash.
let lastKnown: AuthState | null = null

function remember(state: AuthState) {
  lastKnown = state.loading ? lastKnown : state
  return state
}

export function useAuth() {
  const [state, setStateRaw] = useState<AuthState>(
    () =>
      lastKnown ?? {
        loading: true,
        statusError: null,
        setupRequired: false,
        authenticated: false,
        user: null,
      }
  )
  const setState = useCallback(
    (next: AuthState | ((s: AuthState) => AuthState)) =>
      setStateRaw((s) => remember(typeof next === "function" ? next(s) : next)),
    []
  )

  const checkStatus = useCallback(async () => {
    // only show the spinner when there's nothing to show yet
    if (!lastKnown) setState((s) => ({ ...s, loading: true }))
    try {
      const { ok, data } = await authApi.status()
      if (!ok)
        throw new Error(data.error ?? "Authentication service is unavailable")
      setState({
        loading: false,
        statusError: null,
        setupRequired: data.setup_required ?? false,
        authenticated: data.authenticated ?? false,
        user: data.user ?? null,
      })
    } catch (error) {
      setState({
        loading: false,
        statusError:
          error instanceof Error
            ? error.message
            : "Authentication service is unavailable",
        setupRequired: false,
        authenticated: false,
        user: null,
      })
    }
  }, [setState])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const onLoginSuccess = useCallback(
    (token: string, user: AuthUser) => {
      saveToken(token)
      setState({
        loading: false,
        statusError: null,
        setupRequired: false,
        authenticated: true,
        user,
      })
    },
    [setState]
  )

  const logout = useCallback(() => {
    clearToken()
    setState({
      loading: false,
      statusError: null,
      setupRequired: false,
      authenticated: false,
      user: null,
    })
  }, [setState])

  return { ...state, onLoginSuccess, logout, retryStatus: checkStatus }
}
