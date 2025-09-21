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

    const { user_id, is_audio = false } = await request.json();

    // Verify the user_id matches the session
    if (user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Call the Python backend to start the interview session
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || "http://localhost:8000"}/start-interview`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: user_id,
          is_audio: is_audio,
        }),
      },
    );

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error starting interview:", error);
    return NextResponse.json(
      { error: "Failed to start interview session" },
      { status: 500 },
    );
  }
}
