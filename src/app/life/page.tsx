import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import LifeWrap from "../_components/lifewrap";

export default async function LifePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="h-screen w-screen">
      <LifeWrap user={session.user} />
    </div>
  );
}
