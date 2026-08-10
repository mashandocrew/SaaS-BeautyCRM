import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import { Fraunces, Manrope } from "next/font/google"
import "./globals.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
  display: "swap",
})

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "BeautyCRM",
  description: "Gestión para salones de belleza",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.png",
    apple: "/icons/icon-192.png",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1A3A2C",
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="es" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  )
}
