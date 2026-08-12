import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getClients } from "@/lib/client-queries"
import { ClientesList } from "./ClientesList"

export default async function ClientesPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const clients = await getClients(membership.tenant_id)

  return (
    <div>
      <h1>Clientes</h1>
      <ClientesList tenantId={membership.tenant_id} clients={clients} />
    </div>
  )
}
