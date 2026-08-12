import { redirect, notFound } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getClientDetail } from "@/lib/client-queries"
import { ClientDetailView } from "./ClientDetailView"

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const { id } = await params
  const detail = await getClientDetail(membership.tenant_id, id)
  if (!detail) notFound()

  return <ClientDetailView tenantId={membership.tenant_id} detail={detail} />
}
