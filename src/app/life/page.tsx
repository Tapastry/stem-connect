import { auth } from "~/server/auth";
import Life from "../_components/life";

export default async function LifePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold">Please sign in</h1>
          <p className="text-xl text-blue-200">
            You need to be logged in to access your life dashboard
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Life user={session.user} />
    </div>
  );
}
