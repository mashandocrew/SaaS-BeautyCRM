import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"

export default async function HomePage() {
  const { membership } = await getCurrentMembership()

  if (!membership) {
    redirect("/onboarding")
  }

  if (membership.role === "operator") {
    redirect("/o")
  }

  redirect("/dashboard")
}
