"use client"

import { useRouter } from "next/navigation"
import { createClient } from "@beautycrm/supabase/client"
import { Button } from "@beautycrm/ui"

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <Button variant="secondary" onClick={handleSignOut}>
      Salir
    </Button>
  )
}
