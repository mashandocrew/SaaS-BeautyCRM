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
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt=""
            style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)" }}
          />
          <strong style={{ font: "var(--text-h3)" }}>{membership.tenants.business_name}</strong>
        </div>
        <SignOutButton />
      </header>
      <main className="container" style={{ paddingBottom: 24 }}>
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
