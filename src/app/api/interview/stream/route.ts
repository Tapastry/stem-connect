import { NextRequest } from "next/server";
import { auth } from "~/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const isAudio = searchParams.get("isAudio") === "true";
    
    if (userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    const backendUrl = `${process.env.BACKEND_URL || 'http://localhost:8000'}/adk/events/${userId}?is_audio=${isAudio}`;
    console.log(`Proxying SSE request for user ${userId} to ${backendUrl} (audio: ${isAudio})`);

    // Retry logic for 404 errors (session might not be ready yet)
    let backendResponse;
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      backendResponse = await fetch(backendUrl, {
        method: "GET",
        headers: {
          "Accept": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });

      if (backendResponse.ok) {
        break;
      }

      if (backendResponse.status === 404 && retryCount < maxRetries - 1) {
        console.log(`Backend session not ready, retrying in ${(retryCount + 1) * 500}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 500));
        retryCount++;
        continue;
      }

      console.error(`Backend error for SSE stream: ${backendResponse.status} ${backendResponse.statusText}`);
      const text = await backendResponse.text();
      return new Response(text, { status: backendResponse.status });
    }

    return new Response(backendResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });

  } catch (error) {
    console.error("Error in interview stream proxy:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
