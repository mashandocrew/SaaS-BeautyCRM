"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarBlank, User, Wallet } from "@phosphor-icons/react"

const ITEMS = [
  { href: "/o", label: "Mi día", icon: CalendarBlank },
  { href: "/o/cliente", label: "Mi cliente", icon: User },
  { href: "/o/comisiones", label: "Mis comisiones", icon: Wallet },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="nav-bottom">
      {ITEMS.map((item) => {
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
