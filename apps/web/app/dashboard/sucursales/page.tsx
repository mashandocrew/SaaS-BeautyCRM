import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getBranches } from "@/lib/sucursales-queries"
import { BranchList } from "./BranchList"
import { TenantModeCard } from "./TenantModeCard"

export default async function SucursalesPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")
  // branches_insert/update ya son de dueña y encargada (0001); una
  // operadora llegaría hasta acá y no podría hacer nada.
  if (membership.role === "operator") redirect("/dashboard")

  const branches = await getBranches(membership.tenant_id)

  return (
    <div>
      <h1>Sucursales</h1>
      <BranchList tenantId={membership.tenant_id} branches={branches} canDelete={membership.role === "owner"} />
      {membership.role === "owner" ? (
        <TenantModeCard tenantId={membership.tenant_id} mode={membership.tenants.mode} />
      ) : null}
    </div>
  )
}
