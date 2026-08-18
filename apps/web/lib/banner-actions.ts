"use server"

import "server-only"
import { createClient } from "@beautycrm/supabase/server"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

/** Claves de los carteles descartables que existen hoy. Una por cartel. */
export type BannerKey = "promo_pricing"

export async function getDismissedBanners(userId: string): Promise<BannerKey[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("users").select("dismissed_banners").eq("id", userId).maybeSingle()
  return (data?.dismissed_banners ?? []) as BannerKey[]
}

/**
 * Agrega la clave al array sin pisar lo que ya había: dos carteles cerrados
 * en pestañas distintas casi al mismo tiempo no deberían poder hacer que uno
 * "resucite" por una escritura que llegó con el array viejo. select() antes
 * del update es la forma simple de evitar esa carrera a esta escala (un
 * array de a lo sumo unos pocos carteles, nunca escrito por más de un
 * proceso concurrente real).
 */
export async function dismissBanner(bannerKey: BannerKey): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión inválida." }

  const current = await getDismissedBanners(user.id)
  if (current.includes(bannerKey)) return { ok: true, data: undefined }

  const { error } = await supabase
    .from("users")
    .update({ dismissed_banners: [...current, bannerKey] })
    .eq("id", user.id)

  if (error) return { ok: false, error: "No pudimos guardar la preferencia.", code: error.code }
  return { ok: true, data: undefined }
}
