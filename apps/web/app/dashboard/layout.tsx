import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { getCurrentMembership } from "@/lib/session"
import { SignOutButton } from "@/components/SignOutButton"

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, membership } = await getCurrentMembership()

  if (!user) redirect("/login")
  if (!membership) redirect("/onboarding")
  if (membership.role === "operator") redirect("/o")

  const isMulti = membership.tenants.mode === "multi"

  return (
    <div>
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
        <div>
          <strong>{membership.tenants.business_name}</strong>
          {/* Selector de sucursal: oculto en modo single (Bloque A.3) */}
          {isMulti ? (
            <span style={{ marginLeft: 12, color: "var(--ink-soft)", fontSize: 13 }}>
              {membership.branches?.name ?? "Todas las sucursales"}
            </span>
          ) : null}
        </div>
        <SignOutButton />
      </header>
      <main className="container">{children}</main>
    </div>
  )
}
