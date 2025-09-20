"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Message {
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  id: string;
}

export default function InterviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [currentAgentMessage, setCurrentAgentMessage] = useState("");
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentAgentMessage]);

  // Auto-start interview on page load
  useEffect(() => {
    if (session?.user?.id && !isConnected) {
      connectToSSE();
    }
  }, [session?.user?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const connectToSSE = () => {
    if (!session?.user?.id) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const sseUrl = `/api/interview/stream?userId=${session.user.id}`;
    console.log("🔗 Connecting to SSE stream at:", sseUrl);
    
    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("✅ SSE connection opened");
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      console.log("📨 SSE message received:", event.data);
      
      try {
        const data = JSON.parse(event.data);
        console.log("📋 Parsed SSE data:", data);
        
        // Handle turn complete
        if (data.turn_complete) {
          console.log("🏁 Turn complete, finalizing message");
          if (currentAgentMessage.trim()) {
            setMessages(prev => [...prev, {
              role: "agent",
              content: currentAgentMessage.trim(),
              timestamp: new Date(),
              id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            }]);
            setCurrentAgentMessage("");
          }
          return;
        }

        // Handle text data - accumulate all text chunks until turn_complete
        if (data.mime_type === "text/plain" && data.data) {
          console.log("📝 Processing text chunk:", data.data.substring(0, 50) + "...");
          
          setCurrentAgentMessage(prev => {
            const newMessage = prev + data.data;
            console.log("📝 Accumulated text:", newMessage.length, "chars");
            return newMessage;
          });
        }

      } catch (error) {
        console.error("❌ Error parsing SSE data:", error, "Raw data:", event.data);
      }
    };

    eventSource.onerror = (error) => {
      console.error("❌ SSE connection error:", error);
      setIsConnected(false);
      
      // Retry after 3 seconds
      setTimeout(() => {
        if (eventSourceRef.current === eventSource) {
          console.log("🔄 Retrying SSE connection...");
          connectToSSE();
        }
      }, 3000);
    };

    eventSource.onclose = () => {
      console.log("🔌 SSE connection closed");
      setIsConnected(false);
    };
  };

  const sendMessage = async () => {
    if (!currentInput.trim() || !session?.user?.id) return;

    const userMessage = currentInput.trim();
    setCurrentInput("");

    // Clear any existing agent message being typed
    setCurrentAgentMessage("");

    // Add user message to chat
    setMessages(prev => [...prev, {
      role: "user",
      content: userMessage,
      timestamp: new Date(),
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }]);

    console.log("📤 Sending message:", userMessage);

    try {
      const response = await fetch("/api/interview/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: session.user.id,
          mime_type: "text/plain",
          data: userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      console.log("✅ Message sent successfully");
    } catch (error) {
      console.error("❌ Error sending message:", error);
    }
  };

  // Show loading state while checking authentication
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!session) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white">
        <div className="max-w-md text-center space-y-6">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Personal Life Path Interview
          </h1>
          <p className="text-gray-300 text-lg">
            Sign in to start your personalized interview and create your life path visualization.
          </p>
          <button
            onClick={() => signIn()}
            className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 font-semibold"
          >
            Sign In to Start
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-black to-purple-900/20" />
      
      {/* Header */}
      <div className="relative z-10 p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              ← Back
            </button>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Life Path Interview
              </h1>
              <p className="text-gray-400 mt-1">
                Share your story to create your visualization
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
              isConnected 
                ? "bg-green-500/20 text-green-400 border border-green-500/30" 
                : "bg-red-500/20 text-red-400 border border-red-500/30"
            }`}>
              {isConnected ? "Connected" : "Connecting..."}
            </div>
            <button
              onClick={() => router.push("/life")}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
            >
              View Visualization
            </button>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 pb-6">
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
          {/* Messages Area */}
          <div className="h-96 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && !currentAgentMessage && (
              <div className="text-center text-gray-400 py-12">
                <div className="text-6xl mb-4">🤖</div>
                <p className="text-lg">Waiting for AI interviewer to start...</p>
              </div>
            )}
            
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] px-4 py-3 rounded-2xl ${
                    message.role === "user"
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-br-md"
                      : "bg-white/10 backdrop-blur-sm text-gray-100 rounded-bl-md border border-white/20"
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                  <div className={`text-xs mt-2 opacity-70 ${
                    message.role === "user" ? "text-blue-100" : "text-gray-400"
                  }`}>
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}

            {/* Current agent message (typing indicator) */}
            {currentAgentMessage && (
              <div className="flex justify-start">
                <div className="max-w-[70%] px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-sm text-gray-100 rounded-bl-md border border-white/20">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{currentAgentMessage}</p>
                  <div className="text-xs mt-2 text-gray-400 opacity-70 flex items-center space-x-1">
                    <div className="flex space-x-1">
                      <div className="w-1 h-1 bg-blue-400 rounded-full animate-pulse"></div>
                      <div className="w-1 h-1 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-1 h-1 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                    <span className="ml-2">typing...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-6 border-t border-white/10">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex space-x-3"
            >
              <input
                type="text"
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                placeholder="Share your thoughts and experiences..."
                className="flex-1 px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-white placeholder-gray-400"
                disabled={!isConnected}
              />
              <button
                type="submit"
                disabled={!isConnected || !currentInput.trim()}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium"
              >
                Send
              </button>
            </form>
            
            <p className="text-xs text-gray-500 mt-3 text-center">
              Press Enter to send • Be authentic and share your genuine experiences
            </p>
          </div>
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
    </div>
  );
}