import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { getCurrentMembership } from "@/lib/session"
import { SignOutButton } from "@/components/SignOutButton"
import { Sidebar } from "@/components/Sidebar"

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño/a",
  supervisor: "Supervisor/a",
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, membership } = await getCurrentMembership()

  if (!user) redirect("/login")
  if (!membership) redirect("/onboarding")
  if (membership.role === "operator") redirect("/o")

  const isMulti = membership.tenants.mode === "multi"

  return (
    <div className="app-shell">
      <Sidebar
        businessName={membership.tenants.business_name}
        ownerName={user.email ?? ""}
        roleLabel={ROLE_LABEL[membership.role] ?? membership.role}
      />
      <div className="app-main">
        <header className="app-topbar">
          {/* Selector de sucursal: oculto en modo single (Bloque A.3) */}
          {isMulti ? (
            <span className="branch-pill">{membership.branches?.name ?? "Todas las sucursales"}</span>
          ) : null}
          <div style={{ marginLeft: isMulti ? "var(--space-3)" : 0 }}>
            <SignOutButton />
          </div>
        </header>
        <main className="container" style={{ maxWidth: 1100 }}>
          {children}
        </main>
      </div>
    </div>
  )
}
