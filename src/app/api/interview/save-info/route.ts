/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const personalInfo = await request.json();

    // Add the userId from the session
    personalInfo.userId = session.user.id;

    // Call the Python backend to save personal information
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || "http://localhost:8000"}/save-personal-information`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(personalInfo),
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
