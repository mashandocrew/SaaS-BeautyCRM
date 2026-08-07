"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const ITEMS = [
  { href: "/o", label: "Mi día" },
  { href: "/o/cliente", label: "Mi cliente" },
  { href: "/o/comisiones", label: "Mis comisiones" },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="nav-bottom">
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} data-active={pathname === item.href}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
