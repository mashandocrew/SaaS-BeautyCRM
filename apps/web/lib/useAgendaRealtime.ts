"use client"

import { useEffect, useRef } from "react"
import { createClient } from "@beautycrm/supabase/client"

/**
 * Se suscribe a cambios de `appointments` para este tenant y llama a
 * onChange (normalmente router.refresh()) en cada evento. onChange se
 * guarda en un ref para no tener que resuscribirse en cada render — el
 * canal solo depende de tenantId.
 */
export function useAgendaRealtime(tenantId: string, onChange: () => void) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`agenda-changes-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `tenant_id=eq.${tenantId}` },
        () => onChangeRef.current()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tenantId])
}
