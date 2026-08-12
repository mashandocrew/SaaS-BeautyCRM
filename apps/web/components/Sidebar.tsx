"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  SquaresFour,
  CalendarBlank,
  Users,
  Scissors,
  Package,
  Receipt,
  Wallet,
  ChartBar,
  Buildings,
  Gear,
} from "@phosphor-icons/react"
import type { Icon } from "@phosphor-icons/react"

type NavItem = {
  href: string
  label: string
  icon: Icon
  implemented: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Panel de control", icon: SquaresFour, implemented: true },
  { href: "/dashboard/agenda", label: "Agenda", icon: CalendarBlank, implemented: true },
  { href: "/dashboard/clientes", label: "Clientes", icon: Users, implemented: true },
  { href: "/dashboard/servicios", label: "Servicios", icon: Scissors, implemented: true },
  { href: "/dashboard/inventario", label: "Inventario", icon: Package, implemented: false },
  { href: "/dashboard/caja", label: "Caja / POS", icon: Receipt, implemented: false },
  { href: "/dashboard/comisiones", label: "Comisiones", icon: Wallet, implemented: false },
  { href: "/dashboard/reportes", label: "Reportes", icon: ChartBar, implemented: false },
  { href: "/dashboard/sucursales", label: "Sucursales", icon: Buildings, implemented: false },
  { href: "/dashboard/configuracion", label: "Configuración", icon: Gear, implemented: false },
]

export function Sidebar({
  businessName,
  ownerName,
  roleLabel,
}: {
  businessName: string
  ownerName: string
  roleLabel: string
}) {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" />
        <div>
          <div className="sidebar-brand-name">BeautyCRM</div>
          <div className="sidebar-brand-sub">{businessName}</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="sidebar-item"
              data-active={active}
              data-soon={!item.implemented}
            >
              <Icon size={20} weight="regular" />
              <span className="sidebar-item-label">{item.label}</span>
              {!item.implemented ? <span className="sidebar-soon-badge">Pronto</span> : null}
            </Link>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div>
          <p className="sidebar-footer-name">{ownerName}</p>
          <p className="sidebar-footer-role">{roleLabel}</p>
        </div>
      </div>
    </aside>
  )
}
