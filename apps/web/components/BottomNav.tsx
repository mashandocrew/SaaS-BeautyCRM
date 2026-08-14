"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarBlank, Receipt, User, Wallet } from "@phosphor-icons/react"

const ITEMS = [
  { href: "/o", label: "Mi día", icon: CalendarBlank },
  { href: "/o/cliente", label: "Mi cliente", icon: User },
  { href: "/o/comisiones", label: "Mis comisiones", icon: Wallet },
]

const CAJA_ITEM = { href: "/o/caja", label: "Caja", icon: Receipt }

/**
 * canOperateCash decide si aparece el link a la caja. Es solo la barrera de
 * la UI: la real está en app.can_operate_cash, que rechaza los RPC con
 * 42501 aunque alguien entre a /o/caja escribiendo la URL.
 */
export function BottomNav({ canOperateCash = false }: { canOperateCash?: boolean }) {
  const pathname = usePathname()
  const items = canOperateCash ? [...ITEMS, CAJA_ITEM] : ITEMS

  return (
    <nav className="nav-bottom">
      {items.map((item) => {
        const active = pathname === item.href
        const Icon = item.icon
        return (
          <Link key={item.href} href={item.href} data-active={active}>
            <Icon size={22} weight="regular" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
