"use server"

import { createClient, createServiceRoleClient } from "@beautycrm/supabase/server"
import { sendWhatsAppInvite, WhatsAppNotConfiguredError } from "@/lib/whatsapp"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Paso 0 — Registro y activación de promo.
 * Llama al RPC público (public.provision_tenant, wrapper de app.provision_tenant)
 * que crea tenant + sucursal "Principal" + membership owner + 3 presets de
 * comisión, todo en una transacción. La función en SQL ya bloquea que un
 * usuario dueño de un tenant provisione uno segundo — acá solo traducimos
 * ese error a un mensaje legible (nunca una pantalla rota).
 */
export async function provisionTenant(
  businessName: string
): Promise<ActionResult<{ tenantId: string; branchId: string }>> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: "Sesión inválida. Iniciá sesión de nuevo." }

  const { data, error } = await supabase.rpc("provision_tenant", {
    p_business_name: businessName,
  })

  if (error) {
    if (error.message.includes("ya es dueño de un tenant existente")) {
      return {
        ok: false,
        error: "Esta cuenta ya tiene un negocio creado. No podés crear otro.",
      }
    }
    return { ok: false, error: "No pudimos crear tu negocio. Probá de nuevo." }
  }

  const row = data?.[0]
  if (!row) return { ok: false, error: "No pudimos crear tu negocio. Probá de nuevo." }

  return { ok: true, data: { tenantId: row.tenant_id, branchId: row.branch_id } }
}

/**
 * Paso 1 — Identidad del negocio: horario, zona horaria y moneda viven en
 * tenants.settings (jsonb). Todo salteable/editable después.
 */
export async function updateTenantSettings(
  tenantId: string,
  settings: { currency?: string; timezone?: string; hours?: string }
): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: tenant, error: fetchError } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .single()

  if (fetchError) return { ok: false, error: "No pudimos leer el negocio." }

  const { error } = await supabase
    .from("tenants")
    .update({ settings: { ...(tenant.settings as object), ...settings } })
    .eq("id", tenantId)

  if (error) return { ok: false, error: "No pudimos guardar los datos." }

  return { ok: true, data: undefined }
}

type ServiceDraft = {
  name: string
  duration_minutes: number
  price: number
  category: string
}

/**
 * Paso 2 — Servicios. Nunca arranca de una pantalla vacía: el wizard le
 * pasa la plantilla del rubro elegido ya pre-cargada (ver templates.ts),
 * el dueño la edita/recorta acá.
 */
export async function saveServices(
  tenantId: string,
  services: ServiceDraft[]
): Promise<ActionResult> {
  if (services.length === 0) {
    return { ok: true, data: undefined }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("services")
    .insert(services.map((s) => ({ ...s, tenant_id: tenantId })))

  if (error) return { ok: false, error: "No pudimos guardar los servicios." }

  return { ok: true, data: undefined }
}

/**
 * Paso 3 — Equipo. Invita a la operadora por email (magic link, vía
 * admin.inviteUserByEmail) o por WhatsApp (Meta Cloud API, Bloque B.3).
 * Ambos caminos requieren service role porque crean el usuario de auth
 * directamente, sin que la operadora se autoregistre. Al entrar por el
 * link, el trigger on_auth_user_created crea su fila en public.users, y
 * acá le creamos la membership con rol operator y la regla de comisión
 * elegida.
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

  return { ok: true, data: undefined }
}

/**
 * Paso 4 — Primer turno. Cliente nuevo con solo nombre y teléfono +
 * un turno de mañana. Gamificado en la UI (checklist "4 de 5"), no acá.
 */
export async function createFirstAppointment(
  tenantId: string,
  branchId: string,
  input: {
    clientName: string
    clientPhone: string
    serviceId: string
    startsAt: string
    durationMinutes: number
  }
): Promise<ActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("price")
    .eq("id", input.serviceId)
    .single()

  if (serviceError || !service) return { ok: false, error: "Servicio inválido." }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .insert({ tenant_id: tenantId, full_name: input.clientName, phone: input.clientPhone })
    .select()
    .single()

  if (clientError || !client) return { ok: false, error: "No pudimos crear el cliente." }

  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)

  const { data: appointment, error: apptError } = await supabase
    .from("appointments")
    .insert({
      tenant_id: tenantId,
      branch_id: branchId,
      client_id: client.id,
      operator_id: user.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "booked",
      source: "internal",
    })
    .select()
    .single()

  if (apptError || !appointment) return { ok: false, error: "No pudimos cargar el turno." }

  const { error: apptServiceError } = await supabase.from("appointment_services").insert({
    appointment_id: appointment.id,
    service_id: input.serviceId,
    price_snapshot: service.price,
  })

  if (apptServiceError) return { ok: false, error: "No pudimos asociar el servicio al turno." }

  return { ok: true, data: undefined }
}
