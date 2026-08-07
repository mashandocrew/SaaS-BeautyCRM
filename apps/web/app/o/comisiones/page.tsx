import { redirect } from "next/navigation"
import { createClient } from "@beautycrm/supabase/server"
import { getCurrentMembership } from "@/lib/session"
import { ComisionesLive } from "./ComisionesLive"

export default async function MisComisionesPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  const supabase = await createClient()
  const now = new Date()
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  // commission_ledger_select: operator_id = auth.uid() OR owner del tenant.
  // Acá siempre es la propia operadora, RLS ya se encarga. El fetch inicial
  // es server-side (primer render sin esperar el websocket); a partir de ahí
  // ComisionesLive toma la posta con una suscripción Realtime.
  const { data: ledger } = await supabase
    .from("commission_ledger")
    .select("id, amount, settled, sale_items(item_type, quantity, unit_price)")
    .eq("operator_id", user.id)
    .eq("period", period)
    .order("id", { ascending: false })

  return (
    <div>
      <h1>Mis comisiones</h1>
      <p style={{ color: "var(--ink-soft)" }}>Período {period}</p>

      <ComisionesLive initialLedger={ledger ?? []} operatorId={user.id} period={period} />
    </div>
  )
}
