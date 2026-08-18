"use client"

import { useRouter, useSearchParams } from "next/navigation"

/**
 * Selector de sucursal para módulos que en modo single no lo necesitan
 * (Caja, Inventario): en multi-sede, la dueña (branch_id null en su
 * membership) tiene que poder elegir y cambiar de sucursal desde acá, algo
 * que hasta ahora sólo existía en Agenda. La encargada no lo ve — su
 * membership ya trae branch_id fijo y el server component ni la deja
 * llegar con otro valor.
 *
 * Reemplaza sólo `paramName` en la URL actual y preserva el resto de los
 * searchParams (por ejemplo `turno` en Caja).
 */
export function BranchSwitcher({
  branches,
  currentBranchId,
  paramName = "sucursal",
}: {
  branches: { id: string; name: string }[]
  currentBranchId: string
  paramName?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  if (branches.length === 0) return null

  function handleChange(newBranchId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(paramName, newBranchId)
    router.push(`?${params.toString()}`)
  }

  return (
    <select
      className="input"
      value={currentBranchId}
      onChange={(e) => handleChange(e.target.value)}
      aria-label="Elegir sucursal"
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  )
}
