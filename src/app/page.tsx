import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import Landing from "./_components/landing";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    void api.post.getLatest.prefetch();
  }

  return <Landing />;
}
