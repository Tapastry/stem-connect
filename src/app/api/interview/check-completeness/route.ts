import { NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversation_history } = await request.json();

    // Check interview completeness with the Python backend
    const backendResponse = await fetch(
      `${process.env.BACKEND_URL || 'http://localhost:8000'}/adk/check-completeness/${session.user.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_history: conversation_history,
        }),
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
