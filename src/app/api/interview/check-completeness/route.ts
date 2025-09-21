/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the original request body
    const requestBody = await request.json();

    // Forward the entire original body to the Python backend
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || 'http://localhost:8000'}/adk/check-completeness`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`);
    }

    const completenessData = await backendResponse.json();
    
    return NextResponse.json(completenessData);
  } catch (error) {
    console.error("Error checking interview completeness:", error);
    return NextResponse.json(
      { error: "Failed to check interview completeness" },
      { status: 500 }
    );
  }
}
