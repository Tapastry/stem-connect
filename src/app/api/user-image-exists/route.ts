/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Forward the request to the backend
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || "http://localhost:8000"}/api/user-image-exists/${session.user.id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`);
    }

    const imageData = await backendResponse.json();

    return NextResponse.json(imageData);
  } catch (error) {
    console.error("Error checking user image:", error);
    return NextResponse.json(
      { error: "Failed to check user image" },
      { status: 500 },
    );
  }
}
