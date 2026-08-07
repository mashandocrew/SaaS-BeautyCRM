import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { OnboardingWizard } from "./OnboardingWizard"

export default async function OnboardingPage() {
  const { user, membership } = await getCurrentMembership()

  if (!user) redirect("/login")
  if (membership) redirect("/")

  return <OnboardingWizard />
}
