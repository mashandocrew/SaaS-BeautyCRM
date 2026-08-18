"use server"

import { createClient, createServiceRoleClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import { sendWhatsAppInvite, WhatsAppNotConfiguredError } from "@/lib/whatsapp"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Invita a una operadora — usada tanto en el Paso 4 del onboarding (alta
 * inicial) como en Configuración (después, para ir sumando equipo). La
 * lógica es la misma en los dos casos, así que vive acá y no en
 * app/onboarding/actions.ts: onboarding la reexporta.
 *
 * Camino WhatsApp: usamos admin.generateLink (crea el usuario y devuelve
 * el link, sin mandar el email que dispararía inviteUserByEmail) y
 * mandamos ese link por Meta Cloud API. Si WhatsApp no está configurado
 * en el tenant, se lo decimos al dueño en vez de fallar en silencio.
 */
export async function inviteOperator(
  tenantId: string,
  branchId: string,
  input: {
    fullName: string
    email: string
    commissionRuleId: string
    channel?: "email" | "whatsapp"
    phone?: string
  }
): Promise<ActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  // inviteUserByEmail/generateLink corren con service role (bypasean RLS)
  // porque crean el usuario de auth directamente — por eso la verificación
  // de que quien llama es owner de ESTE tenant se hace acá a mano, antes
  // de disparar el invite. Sin esto, cualquier usuario autenticado podría
  // hacer que el servidor mande invitaciones a nombre de un tenant ajeno.
  const { data: ownerMembership } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .maybeSingle()

  if (!ownerMembership) {
    return { ok: false, error: "No tenés permiso para invitar operadoras en este negocio." }
  }

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!branch) {
    return { ok: false, error: "La sucursal no pertenece a este negocio." }
  }

  const { data: rule } = await supabase
    .from("commission_rules")
    .select("id")
    .eq("id", input.commissionRuleId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!rule) {
    return { ok: false, error: "La regla de comisión no pertenece a este negocio." }
  }

  const admin = createServiceRoleClient()
  const channel = input.channel ?? "email"
  let invitedUserId: string

  if (channel === "whatsapp") {
    if (!input.phone) {
      return { ok: false, error: "Falta el teléfono para invitar por WhatsApp." }
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "invite",
      email: input.email,
      options: { data: { full_name: input.fullName } },
    })

    if (linkError || !linkData?.user) {
      return {
        ok: false,
        error: `No pudimos invitar a ${input.email}. Verificá que el email esté bien escrito.`,
      }
    }

    try {
      await sendWhatsAppInvite({
        phone: input.phone,
        fullName: input.fullName,
        actionLink: linkData.properties.action_link,
      })
    } catch (err) {
      if (err instanceof WhatsAppNotConfiguredError) {
        return {
          ok: false,
          error:
            "WhatsApp todavía no está configurado en este negocio. Invitá por email mientras tanto.",
        }
      }
      return {
        ok: false,
        error: `Creamos el acceso pero no pudimos mandarlo por WhatsApp a ${input.phone}. Probá de nuevo o invitá por email.`,
      }
    }

    invitedUserId = linkData.user.id
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      input.email,
      { data: { full_name: input.fullName } }
    )

    if (inviteError || !invited.user) {
      return {
        ok: false,
        error: `No pudimos invitar a ${input.email}. Verificá que el email esté bien escrito.`,
      }
    }

    invitedUserId = invited.user.id
  }

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenantId,
    user_id: invitedUserId,
    branch_id: branchId,
    role: "operator",
    commission_rule_id: input.commissionRuleId,
  })

  if (membershipError) {
    return { ok: false, error: "Invitamos a la operadora pero no pudimos asignarle el rol." }
  }

  revalidatePath("/dashboard/configuracion")
  return { ok: true, data: undefined }
}
