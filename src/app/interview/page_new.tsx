/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  id: string;
}

export default function InterviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Core state - SIMPLIFIED FOR TEXT-ONLY
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [currentAgentMessage, setCurrentAgentMessage] = useState("");
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);

  // TTS state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);

  // Debug flags
  const [debugMode] = useState(true);

  // Refs - SIMPLIFIED
  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCountRef = useRef(0);
  const currentAgentMessageRef = useRef<string>("");
  const processingEventRef = useRef<boolean>(false);
  const ttsRef = useRef<SpeechSynthesisUtterance | null>(null);

  // TTS Function using Web Speech API
  const speakText = (text: string) => {
    if (!ttsEnabled || !text.trim()) return;

    console.log(`🔊 [TTS] Speaking: "${text.substring(0, 50)}..."`);

    // Stop any current speech
    if (ttsRef.current) {
      speechSynthesis.cancel();
    }

    setIsSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.pitch = 1.0;
    utterance.volume = 0.8;

    utterance.onstart = () => {
      console.log(`[TTS] Started speaking`);
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      console.log(`[TTS] Finished speaking`);
      setIsSpeaking(false);
    };

    utterance.onerror = (error) => {
      console.error(`[TTS] Error:`, error);
      setIsSpeaking(false);
    };

    ttsRef.current = utterance;
    speechSynthesis.speak(utterance);
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentAgentMessage]);

  // Redirect to /life when interview is complete
  useEffect(() => {
    if (interviewComplete) {
      console.log("Interview complete, redirecting to /life in 2 seconds...");
      setTimeout(() => {
        console.log("Redirecting now...");
        router.push("/life");
      }, 2000);
    }
  }, [interviewComplete, router]);

  // Auto-start interview on page load
  useEffect(() => {
    console.log(
      `Page loaded - session: ${!!session?.user?.id}, connecting: ${isConnecting}`,
    );
    if (session?.user?.id && !isConnecting && !eventSourceRef.current) {
      console.log("Starting interview connection...");
      setTimeout(() => connectToSSE(), 100);
    }
  }, [session?.user?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("Component unmounting");
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (ttsRef.current) {
        speechSynthesis.cancel();
      }
    };
  }, []);

  const connectToSSE = () => {
    if (!session?.user?.id || isConnecting) {
      console.log(
        `Cannot connect - user: ${!!session?.user?.id}, connecting: ${isConnecting}`,
      );
      return;
    }

    console.log(`Starting connection for user: ${session.user.id}`);

    // Close existing connection
    if (eventSourceRef.current) {
      console.log("Closing existing connection");
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setTimeout(() => createNewConnection(), 300);
      return;
    }

    createNewConnection();
  };

  const createNewConnection = () => {
    if (!session?.user?.id || isConnecting) {
      console.log(
        `Cannot create connection - user: ${!!session?.user?.id}, connecting: ${isConnecting}`,
      );
      return;
    }

    console.log(`Creating new connection for user: ${session.user.id}`);
    setIsConnecting(true);

    // TEXT-ONLY MODE - no audio parameter needed
    const sseUrl = `/api/interview/stream?userId=${session.user.id}&isAudio=false`;
    console.log(`URL: ${sseUrl}`);

    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("Connection opened");
      setIsConnected(true);
      setIsConnecting(false);
    };

    eventSource.onmessage = (event) => {
      if (processingEventRef.current) {
        console.log(`Event already processing, skipping`);
        return;
      }

      processingEventRef.current = true;
      console.log(`Raw event data:`, event.data);

      try {
        const data = JSON.parse(event.data);
        console.log(`Parsed event:`, data);

        // Handle interview completion via tool call
        if (data.interview_complete) {
          console.log("Interview completed via tool call!");
          const personalInfoData = data.personal_info_data;
          console.log(`Personal info data:`, personalInfoData);

          if (personalInfoData) {
            console.log(`Saving personal info to database...`);
            fetch("/api/interview/save-personal-info", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: session?.user?.id,
                personal_info: personalInfoData,
              }),
            })
              .then((response) => {
                console.log(`Save response status: ${response.status}`);
                if (response.ok) {
                  console.log("Personal information saved successfully");
                  setInterviewComplete(true);
                } else {
                  console.error(
                    "Failed to save personal information - status:",
                    response.status,
                  );
                }
              })
              .catch((error) => {
                console.error("Error saving personal information:", error);
              });
          }
          return;
        }

        // Handle turn complete - TEXT MODE ONLY
        if (data.turn_complete) {
          console.log("Agent finished typing, processing final message");

          if (currentAgentMessageRef.current.trim()) {
            const messageContent = currentAgentMessageRef.current.trim();
            console.log(
              `Final agent message: "${messageContent.substring(0, 100)}..."`,
            );

            const messageId = `agent-${Date.now()}-${Math.random()}`;

            // Add to chat
            setMessages((prev) => [
              ...prev,
              {
                role: "agent",
                content: messageContent,
                timestamp: new Date(),
                id: messageId,
              },
            ]);

            // Speak the message using TTS
            if (ttsEnabled) {
              console.log(`Starting TTS for agent message`);
              speakText(messageContent);
            }

            // Clear current message
            currentAgentMessageRef.current = "";
            setCurrentAgentMessage("");
          }

          setAgentTyping(false);
          console.log("User's turn to respond");
          return;
        }

        // Handle text data - TEXT MODE ONLY
        if (data.mime_type === "text/plain" && data.data) {
          console.log(`Received chunk: "${data.data}"`);

          if (!agentTyping) {
            console.log("Agent started typing");
            setAgentTyping(true);
          }

          // Accumulate text chunks
          const newMessage = currentAgentMessageRef.current + data.data;
          currentAgentMessageRef.current = newMessage;
          setCurrentAgentMessage(newMessage);

          console.log(`Accumulated message length: ${newMessage.length}`);
        }
      } catch (error) {
        console.error(
          "Error parsing event data:",
          error,
          "Raw data:",
          event.data,
        );
      } finally {
        processingEventRef.current = false;
      }
    };

    eventSource.onerror = (error) => {
      console.error("Connection error:", error);
      setIsConnected(false);
      setIsConnecting(false);

      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (session?.user?.id && !isConnecting) {
          console.log("Auto-reconnecting after error...");
          connectToSSE();
        }
      }, 3000);
    };
  };

  const sendMessage = async () => {
    if (!currentInput.trim() || !session?.user?.id) {
      console.log(
        `Cannot send - input: "${currentInput.trim()}", user: ${!!session?.user?.id}`,
      );
      return;
    }

    const userMessage = currentInput.trim();
    console.log(`Sending user message: "${userMessage}"`);

    setCurrentInput("");
    setCurrentAgentMessage("");
    setAgentTyping(true);

    // Stop any current TTS
    if (ttsRef.current) {
      speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    // Add user message to chat
    const userMessageObj = {
      role: "user" as const,
      content: userMessage,
      timestamp: new Date(),
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    console.log(`Adding user message to chat:`, userMessageObj);
    setMessages((prev) => [...prev, userMessageObj]);

    try {
      console.log(`Making API call to send message...`);
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
        const errorText = await response.text();
        console.error(
          "Send failed:",
          response.status,
          response.statusText,
          errorText,
        );
        throw new Error(
          `Failed to send message: ${response.statusText} - ${errorText}`,
        );
      }

      const result = await response.json();
      console.log("Message sent successfully", result);

      messageCountRef.current = result.message_count || 0;
      console.log(`Message count: ${messageCountRef.current}`);
    } catch (error) {
      console.error("Error sending message:", error);
      setAgentTyping(false);
    }
  };

  // Show loading state
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-white"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show sign-in prompt
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="mb-6 text-4xl font-bold">Life Path Interview</h1>
          <p className="mb-8 text-xl text-gray-300">
            Sign in to start your interview
          </p>
          <button
            onClick={() => signIn()}
            className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 px-8 py-3 font-semibold transition-all duration-200 hover:from-blue-600 hover:to-purple-700"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-indigo-900/20"></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent"></div>

      <div className="relative z-10 mx-auto flex h-screen max-w-4xl flex-col">
        {/* Header */}
        <div className="border-b border-white/10 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-2xl font-bold text-transparent">
                Life Path Interview
              </h1>
              <p className="mt-1 text-gray-400">
                Share your story to create your visualization
              </p>
            </div>

            <div className="flex items-center space-x-4">
              <button
                onClick={() => {
                  setTtsEnabled(!ttsEnabled);
                  console.log(`TTS ${ttsEnabled ? "disabled" : "enabled"}`);
                }}
                className={`rounded-lg px-4 py-2 transition-all duration-200 ${
                  ttsEnabled
                    ? "border border-green-500/30 bg-green-500/20 text-green-400"
                    : "border border-gray-500/30 bg-gray-500/20 text-gray-400"
                }`}
                title={
                  ttsEnabled
                    ? "Disable Text-to-Speech"
                    : "Enable Text-to-Speech"
                }
              >
                {ttsEnabled ? "TTS On" : "TTS Off"}
              </button>

              <div
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  isConnected
                    ? "border border-green-500/30 bg-green-500/20 text-green-400"
                    : "border border-red-500/30 bg-red-500/20 text-red-400"
                }`}
              >
                {isConnected
                  ? "Connected"
                  : isConnecting
                    ? "Connecting..."
                    : "Disconnected"}
              </div>
            </div>
          </div>
        </div>

        {/* Interview Complete Banner */}
        {interviewComplete && (
          <div className="border-b border-green-500/30 bg-gradient-to-r from-green-500/20 to-blue-500/20 p-4">
            <div className="text-center">
              <h2 className="mb-2 text-xl font-semibold text-green-400">
                Interview Complete!
              </h2>
              <p className="mb-4 text-gray-300">
                Thank you for sharing your story. We&apos;re now creating your
                life path visualization...
              </p>
              <button
                onClick={() => router.push("/life")}
                className="rounded-lg bg-gradient-to-r from-green-500 to-blue-600 px-6 py-2 font-semibold transition-all duration-200 hover:from-green-600 hover:to-blue-700"
              >
                Create Visualization →
              </button>
            </div>
          </div>
        )}

        {/* Chat Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-4 ${
                  message.role === "user"
                    ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                    : "border border-white/20 bg-white/10 text-gray-100"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                <p className="mt-2 text-xs opacity-70">
                  {message.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}

          {/* Current agent message being typed */}
          {currentAgentMessage && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg border border-white/20 bg-white/10 p-4 text-gray-100">
                <p className="whitespace-pre-wrap">{currentAgentMessage}</p>
                <div className="mt-2 flex items-center">
                  <span className="text-xs text-blue-400">Agent is typing</span>
                  <div className="ml-2 flex space-x-1">
                    <div className="h-1 w-1 animate-bounce rounded-full bg-blue-400"></div>
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-blue-400"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-blue-400"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area - TEXT ONLY */}
        <div className="border-t border-white/10 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              console.log(`Form submitted with input: "${currentInput}"`);
              void sendMessage();
            }}
            className="flex space-x-3"
          >
            <input
              type="text"
              value={currentInput}
              onChange={(e) => {
                setCurrentInput(e.target.value);
                if (debugMode) console.log(`User typing: "${e.target.value}"`);
              }}
              placeholder={
                agentTyping
                  ? "Agent is typing..."
                  : "Share your thoughts and experiences..."
              }
              className="flex-1 rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
              disabled={!isConnected || interviewComplete || agentTyping}
            />
            <button
              type="submit"
              disabled={
                !currentInput.trim() ||
                !isConnected ||
                interviewComplete ||
                agentTyping
              }
              className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3 font-medium transition-all duration-200 hover:from-blue-600 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {agentTyping ? "..." : "Send"}
            </button>
          </form>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Press Enter to send • Be authentic and share your genuine
              experiences
            </p>

            <div className="flex items-center space-x-2">
              {isSpeaking && (
                <span className="text-xs text-blue-400">Speaking...</span>
              )}
              <span
                className={`text-xs ${isConnected ? "text-green-400" : "text-red-400"}`}
              >
                {isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
