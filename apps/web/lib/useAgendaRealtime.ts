"use client"

import { useEffect, useRef } from "react"
import { createClient } from "@beautycrm/supabase/client"

/**
 * Se suscribe a cambios de `appointments` para este tenant y llama a
 * onChange (normalmente router.refresh()) en cada evento. onChange se
 * guarda en un ref para no tener que resuscribirse en cada render — el
 * canal solo depende de tenantId.
 *
 * Espera a que la sesión esté hidratada (supabase.auth.getSession())
 * antes de suscribirse: si el canal se une al socket de Realtime antes
 * de que el cliente tenga el JWT del usuario seteado, se une como
 * 'anon' — la conexión queda "SUBSCRIBED" igual, pero RLS descarta en
 * silencio todos los eventos porque una conexión anon no matchea
 * ninguna fila de appointments_select. Esperar getSession() garantiza
 * que realtime.setAuth() ya corrió.
 */
export function useAgendaRealtime(tenantId: string, onChange: () => void) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    supabase.auth
      .getSession()
      .then(() => {
        if (cancelled) return
        channel = supabase
          .channel(`agenda-changes-${tenantId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "appointments", filter: `tenant_id=eq.${tenantId}` },
            () => onChangeRef.current()
          )
          .subscribe()
      })
      .catch(() => {
        // Si getSession() rechaza (ej. red caída), simplemente no nos
        // suscribimos a Realtime — el resto de la pantalla (datos server-
        // rendered + router.refresh() manual) sigue funcionando. No hay
        // nada útil que hacer acá aparte de no dejar la promise sin manejar.
      })

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [tenantId])
}
