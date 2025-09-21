/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user_id, personal_info } = await request.json();

    // Verify the user_id matches the session
    if (user_id !== session.user.id) {
      return NextResponse.json({ error: "User ID mismatch" }, { status: 403 });
    }

    // Forward to the backend to save personal information
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || "http://localhost:8000"}/api/save-personal-info`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: user_id,
          personal_info: personal_info,
        }),
      },
    );

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`);
    }

    const result = await backendResponse.json();

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error saving personal information:", error);
    return NextResponse.json(
      { error: "Failed to save personal information" },
      { status: 500 },
    );
  }
}
