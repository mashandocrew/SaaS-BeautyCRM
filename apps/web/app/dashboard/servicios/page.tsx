import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getServices } from "@/lib/service-queries"
import { ServicesList } from "./ServicesList"

export default async function ServiciosPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const services = await getServices(membership.tenant_id)

  return (
    <div>
      <h1>Servicios</h1>
      {/* role viaja hasta el Sheet para decidir si se muestra "Eliminar
          servicio": services_delete es owner-only. El layout de /dashboard
          ya sacó a las operadoras, así que acá role es owner o supervisor. */}
      <ServicesList tenantId={membership.tenant_id} services={services} role={membership.role} />
    </div>
  )
}
