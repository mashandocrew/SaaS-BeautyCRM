import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { getCurrentMembership } from "@/lib/session"
import { BottomNav } from "@/components/BottomNav"
import { SignOutButton } from "@/components/SignOutButton"

export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const { user, membership } = await getCurrentMembership()

  if (!user) redirect("/login")
  if (!membership) redirect("/onboarding")

  return (
    <div style={{ paddingBottom: 56 }}>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--card)",
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>{membership.tenants.business_name}</strong>
        <SignOutButton />
      </header>
      <main className="container" style={{ paddingBottom: 24 }}>
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
