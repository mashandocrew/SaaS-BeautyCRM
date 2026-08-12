"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Users, Plus } from "@phosphor-icons/react"
import { Button, Card, EmptyState, Input } from "@beautycrm/ui"
import type { ClientRecord } from "@/lib/client-types"
import { ClientFormSheet } from "./ClientFormSheet"

export function ClientesList({ tenantId, clients }: { tenantId: string; clients: ClientRecord[] }) {
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.full_name.toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q))
  }, [clients, query])

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-4)",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <Input
          placeholder="Buscar por nombre o teléfono..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 320, flex: 1 }}
        />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" /> Nuevo cliente
        </Button>
      </div>

      <Card>
        {clients.length === 0 ? (
          <EmptyState
            icon={<Users size={24} weight="regular" />}
            title="Todavía no hay clientes"
            description="Se cargan acá o automáticamente desde el modal de nuevo turno en Agenda."
            action={<Button onClick={() => setCreateOpen(true)}>Nuevo cliente</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={24} weight="regular" />}
            title="Sin resultados"
            description={`No encontramos a nadie que coincida con "${query}".`}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/dashboard/clientes/${c.id}`}>{c.full_name}</Link>
                  </td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ClientFormSheet open={createOpen} onClose={() => setCreateOpen(false)} tenantId={tenantId} mode="create" />
    </div>
  )
}
