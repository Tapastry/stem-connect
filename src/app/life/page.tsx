/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import LifeWrap from "../_components/lifewrap";

async function checkPersonalInfo(userId: string) {
  try {
    const response = await fetch(
      `${process.env.BACKEND_URL ?? "http://localhost:8000"}/api/get-personal-info/${userId}`,
      { cache: "no-store" },
    );

    if (response.status === 404) {
      // No personal info found
      return false;
    }

    if (!response.ok) {
      console.error("Failed to check personal info:", response.status);
      return false;
    }

    const personalInfo = await response.json();

    // Check if essential fields are empty
    const hasEssentialInfo =
      personalInfo.bio ??
      personalInfo.background ??
      personalInfo.aspirations ??
      personalInfo.values;

    return hasEssentialInfo;
  } catch (error) {
    console.error("Error checking personal info:", error);
    return false;
  }
}

export default async function LifePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  // Check if user has completed the interview
  const hasPersonalInfo = await checkPersonalInfo(session.user.id);

  if (!hasPersonalInfo) {
    redirect("/interview");
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-indigo-900/20"></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent"></div>

      <div className="relative z-10 h-screen w-screen">
        <LifeWrap user={session.user} />
      </div>
    </div>
  );
}
