import "server-only"

const GRAPH_API_VERSION = "v20.0"

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super(
      "WhatsApp Cloud API no está configurado (faltan WHATSAPP_CLOUD_API_TOKEN, " +
        "WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_INVITE_TEMPLATE_NAME en el entorno)."
    )
    this.name = "WhatsAppNotConfiguredError"
  }
}

function normalizePhone(raw: string): string {
  // Meta Cloud API espera el número en formato E.164 sin el "+" inicial,
  // solo dígitos (código de país + número, ej. 5492611234567).
  return raw.replace(/[^\d]/g, "")
}

/**
 * Envía la invitación de acceso por WhatsApp usando Meta WhatsApp Cloud API
 * (Bloque B.3 — TODO histórico del README, resuelto acá).
 *
 * Requisito de la plataforma, no de esta app: para escribirle primero a
 * alguien que nunca inició la conversación hay que usar una plantilla de
 * mensaje pre-aprobada en Meta Business Manager — no se puede mandar texto
 * libre. La plantilla configurada en WHATSAPP_INVITE_TEMPLATE_NAME debe
 * tener dos variables en el cuerpo: {{1}} nombre, {{2}} link de acceso.
 *
 * Si faltan credenciales, lanza WhatsAppNotConfiguredError — el llamador
 * debe atraparlo y avisar al dueño (ej. "configurá WhatsApp o invitá por
 * email") en vez de fallar en silencio y dejar a la operadora sin acceso.
 */
export async function sendWhatsAppInvite(input: {
  phone: string
  fullName: string
  actionLink: string
}): Promise<void> {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const templateName = process.env.WHATSAPP_INVITE_TEMPLATE_NAME
  const languageCode = process.env.WHATSAPP_INVITE_TEMPLATE_LANG || "es"

  if (!token || !phoneNumberId || !templateName) {
    throw new WhatsAppNotConfiguredError()
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizePhone(input.phone),
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: input.fullName },
                { type: "text", text: input.actionLink },
              ],
            },
          ],
        },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`WhatsApp Cloud API respondió ${res.status}: ${body}`)
  }
}
