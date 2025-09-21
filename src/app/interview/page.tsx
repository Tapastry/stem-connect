/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// TypeScript declarations for Speech Recognition API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

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

  // Speech-to-Text state
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  // Refs - SIMPLIFIED
  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCountRef = useRef(0);
  const currentAgentMessageRef = useRef<string>("");
  const processingEventRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const hasInitialMessage = useRef(false);
  const connectionAttemptRef = useRef(false);

  // Helper function to generate message ID from content
  const generateMessageId = (content: string, role: string) => {
    const hash = content.slice(0, 50) + role + content.length;
    return hash.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  };

  // Helper function to check if message is duplicate
  const isDuplicateMessage = (content: string, role: string) => {
    const messageId = generateMessageId(content, role);
    if (seenMessageIds.current.has(messageId)) {
      return true;
    }
    seenMessageIds.current.add(messageId);
    return false;
  };

  // More aggressive duplicate prevention for agent messages
  const isAgentMessageDuplicate = (content: string) => {
    // Check if this exact message already exists in the messages array
    const existsInMessages = messages.some(
      (msg) => msg.role === "agent" && msg.content.trim() === content.trim(),
    );

    if (existsInMessages) {
      return true;
    }

    return isDuplicateMessage(content, "agent");
  };

  // Speech-to-Text setup
  useEffect(() => {
    // Check if browser supports speech recognition
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: {
        resultIndex: any;
        results: string | any[];
      }) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setCurrentInput(transcript);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (error: any) => {
        console.error("Speech recognition error:", error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } else {
      console.log(`[STT] Speech recognition not supported`);
      setSpeechSupported(false);
    }
  }, []);

  // Start/stop speech recognition
  const toggleSpeechRecognition = () => {
    if (!speechSupported || !recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
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
    if (session?.user?.id && !isConnecting && !eventSourceRef.current) {
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
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      // Clear duplicate tracking
      seenMessageIds.current.clear();
      hasInitialMessage.current = false;
    };
  }, []);

  const connectToSSE = () => {
    if (!session?.user?.id || isConnecting || connectionAttemptRef.current)
      return;

    connectionAttemptRef.current = true;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setTimeout(() => {
        createNewConnection();
        connectionAttemptRef.current = false;
      }, 300);
      return;
    }

    createNewConnection();
    connectionAttemptRef.current = false;
  };

  const createNewConnection = () => {
    if (!session?.user?.id || isConnecting) return;

    setIsConnecting(true);
    const sseUrl = `/api/interview/stream?userId=${session.user.id}&isAudio=false`;
    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setIsConnecting(false);
    };

    eventSource.onmessage = (event) => {
      if (processingEventRef.current) return;
      processingEventRef.current = true;

      try {
        const data = JSON.parse(event.data);

        // Handle interview completion via tool call
        if (data.interview_complete) {
          const personalInfoData = data.personal_info_data;
          if (personalInfoData) {
            fetch("/api/interview/save-personal-info", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: session?.user?.id,
                personal_info: personalInfoData,
              }),
            })
              .then((response) => {
                if (response.ok) {
                  setInterviewComplete(true);
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
          if (currentAgentMessageRef.current.trim()) {
            const messageContent = currentAgentMessageRef.current.trim();

            // Use aggressive duplicate prevention
            if (!isAgentMessageDuplicate(messageContent)) {
              const messageId = `agent-${Date.now()}-${Math.random()}`;

              // Add to chat (replace the current typing message)
              setMessages((prev) => {
                // Remove any existing agent typing message and add the final one
                const filtered = prev.filter(
                  (msg) => msg.id !== "agent-typing",
                );
                return [
                  ...filtered,
                  {
                    role: "agent",
                    content: messageContent,
                    timestamp: new Date(),
                    id: messageId,
                  },
                ];
              });
            }

            // Clear current message
            currentAgentMessageRef.current = "";
            setCurrentAgentMessage("");
          }

          setAgentTyping(false);
          return;
        }

        // Handle text data - REAL-TIME DISPLAY
        if (data.mime_type === "text/plain" && data.data) {
          // Mark that we've received initial message
          if (!hasInitialMessage.current) {
            hasInitialMessage.current = true;
          }

          if (!agentTyping) {
            setAgentTyping(true);
          }

          // Accumulate text chunks
          const newMessage = currentAgentMessageRef.current + data.data;
          currentAgentMessageRef.current = newMessage;
          setCurrentAgentMessage(newMessage);

          // REAL-TIME: Update the chat with current typing message
          setMessages((prev) => {
            // Remove any existing typing message and add updated one
            const filtered = prev.filter((msg) => msg.id !== "agent-typing");
            return [
              ...filtered,
              {
                role: "agent",
                content: newMessage,
                timestamp: new Date(),
                id: "agent-typing", // Special ID for typing message
              },
            ];
          });
        }
      } catch (error) {
        console.error("SSE parsing error:", error);
      } finally {
        processingEventRef.current = false;
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      setIsConnected(false);
      setIsConnecting(false);

      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (session?.user?.id && !isConnecting) {
          connectToSSE();
        }
      }, 3000);
    };
  };

  const sendMessage = async () => {
    if (!currentInput.trim() || !session?.user?.id) return;

    const userMessage = currentInput.trim();

    setCurrentInput("");
    setCurrentAgentMessage("");
    setAgentTyping(true);

    // Stop any current speech recognition
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    // Add user message to chat (check for duplicates)
    if (!isDuplicateMessage(userMessage, "user")) {
      const userMessageObj = {
        role: "user" as const,
        content: userMessage,
        timestamp: new Date(),
        id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };

      setMessages((prev) => [...prev, userMessageObj]);
    }

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

      const result = await response.json();
      messageCountRef.current = result.message_count || 0;
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
              {speechSupported ? (
                <button
                  onClick={toggleSpeechRecognition}
                  className={`rounded-lg px-4 py-2 transition-all duration-200 ${
                    isListening
                      ? "border border-red-500/30 bg-red-500/20 text-red-400"
                      : "border border-blue-500/30 bg-blue-500/20 text-blue-400"
                  }`}
                  title={isListening ? "Stop Voice Input" : "Start Voice Input"}
                  disabled={agentTyping || interviewComplete}
                >
                  {isListening ? "Stop" : "Speak"}
                </button>
              ) : (
                <div
                  className="rounded-lg border border-yellow-500/30 bg-yellow-500/20 px-4 py-2 text-sm text-yellow-400"
                  title="Your browser does not support the Web Speech API. Please use Chrome or Safari for voice input."
                >
                  Voice not supported
                </div>
              )}

              <button
                onClick={() => {
                  setMessages([]);
                  seenMessageIds.current.clear();
                  hasInitialMessage.current = false;
                  setCurrentAgentMessage("");
                  currentAgentMessageRef.current = "";
                }}
                className="rounded-lg border border-red-500/30 bg-red-500/20 px-3 py-1 text-xs text-red-400 hover:bg-red-500/30"
                title="Clear chat and reset duplicate tracking"
              >
                Clear Chat
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
          {messages.map((message) => {
            const isTyping = message.id === "agent-typing";
            return (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    message.role === "user"
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                      : isTyping
                        ? "border border-blue-400/30 bg-white/5 text-gray-100"
                        : "border border-white/20 bg-white/10 text-gray-100"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs opacity-70">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                    {isTyping && (
                      <div className="flex items-center">
                        <span className="mr-2 text-xs text-blue-400">
                          typing
                        </span>
                        <div className="flex space-x-1">
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
                    )}
                  </div>
                </div>
              </div>
            );
          })}

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
              onChange={(e) => setCurrentInput(e.target.value)}
              placeholder={
                agentTyping
                  ? "Agent is typing..."
                  : isListening
                    ? "Listening... (speak now)"
                    : speechSupported
                      ? "Type or click to speak..."
                      : "Share your thoughts and experiences..."
              }
              className={`flex-1 rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-gray-400 focus:border-transparent focus:ring-2 focus:outline-none ${
                isListening
                  ? "border-red-400 focus:ring-red-500"
                  : "border-white/20 focus:ring-blue-500"
              }`}
              disabled={!isConnected || interviewComplete || agentTyping}
            />
            {speechSupported && (
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                disabled={!isConnected || interviewComplete || agentTyping}
                className={`rounded-lg px-4 py-3 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isListening
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-gray-600 text-white hover:bg-gray-700"
                }`}
                title={isListening ? "Stop listening" : "Start voice input"}
              >
                {isListening ? "Stop" : "Speak"}
              </button>
            )}

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
              {isListening && (
                <span className="text-xs text-red-400">Listening...</span>
              )}
              {speechSupported && (
                <span className="text-xs text-gray-500">STT Ready</span>
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
