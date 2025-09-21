/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    
    if (userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check session status with the Python backend
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || 'http://localhost:8000'}/adk/session-status/${userId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`);
    }

    const statusData = await backendResponse.json();
    
    return NextResponse.json(statusData);
  } catch (error) {
    console.error("Error checking session status:", error);
    return NextResponse.json(
      { error: "Failed to check session status" },
      { status: 500 }
    );
  }
}
