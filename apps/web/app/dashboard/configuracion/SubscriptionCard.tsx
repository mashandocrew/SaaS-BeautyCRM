import { Card } from "@beautycrm/ui"

const STATUS_LABELS: Record<string, string> = {
  trial: "Prueba",
  promo: "Promoción",
  active: "Activa",
  past_due: "Pago pendiente",
  cancelled: "Cancelada",
}

export function SubscriptionCard({ status, promoEndsAt }: { status: string; promoEndsAt: string | null }) {
  return (
    <Card>
      <h2>Suscripción</h2>
      <p>
        Estado: <strong>{STATUS_LABELS[status] ?? status}</strong>
      </p>
      {promoEndsAt ? <p style={{ color: "var(--color-ink-soft)" }}>La promoción termina el {new Date(promoEndsAt).toLocaleDateString("es-AR")}.</p> : null}
    </Card>
  )
}
