import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import Landing from "./_components/landing";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/life");
  }

  return <Landing />;
}
