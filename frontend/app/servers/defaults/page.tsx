"use client"

import { useRouter } from "next/navigation"

import { DefaultsEditor } from "@/components/DefaultsEditor"
import { navigate } from "@/components/PageTransitions"
import { RequireAuth } from "@/components/RequireAuth"

/** the properties every new server starts with (admins only) */
export default function DefaultsPage() {
  const router = useRouter()
  return (
    <RequireAuth admin>
      {(user, logout) => (
        <DefaultsEditor
          user={user}
          onLogout={logout}
          onClose={() => navigate("/servers", router.push)}
        />
      )}
    </RequireAuth>
  )
}
