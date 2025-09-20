import { NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user_id, mime_type, data } = await request.json();

    // Verify the user_id matches the session
    if (user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Send message to the Python backend
    const backendResponse = await fetch(`${process.env.BACKEND_URL || 'http://localhost:8000'}/adk/send/${user_id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: user_id,
        mime_type: mime_type,
        data: data,
      }),
    });

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`);
    }

    const responseData = await backendResponse.json();
    
    return NextResponse.json({ 
      success: true,
      message_count: responseData.message_count,
      should_check_completeness: responseData.should_check_completeness
    });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
