"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import PCMVoiceRecorder from "~/components/PCMVoiceRecorder";
import {
  clearAudioQueue,
  initializeGlobalAudioContext,
  isAgentSpeaking,
  playPCMAudio,
  startAudioPlayback
} from "~/lib/pcmAudio";

interface Message {
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  id: string;
}

interface CompletenessResult {
  is_complete: boolean;
  completeness_score: number;
  areas_covered: string[];
  missing_areas: string[];
  reason: string;
  suggested_next_questions?: string[];
}

export default function InterviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [currentAgentMessage, setCurrentAgentMessage] = useState("");
  const [isAudioMode, setIsAudioMode] = useState(true); // Default to voice mode
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [completenessInfo, setCompletenessInfo] = useState<CompletenessResult | null>(null);
  const [isCheckingCompleteness, setIsCheckingCompleteness] = useState(false);
  const [hasReceivedInitialMessage, setHasReceivedInitialMessage] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  
  // Sync state with refs
  useEffect(() => {
    conversationStateRef.current.conversationStarted = conversationStarted;
  }, [conversationStarted]);
  
  useEffect(() => {
    conversationStateRef.current.hasReceivedInitialMessage = hasReceivedInitialMessage;
  }, [hasReceivedInitialMessage]);
  const [agentTurn, setAgentTurn] = useState(true); // true when agent is speaking, false when user can respond
  
  // Debug agentTurn changes
  useEffect(() => {
    console.log(`🔄 AGENT TURN STATE CHANGED: ${agentTurn ? 'AGENT\'S TURN (mic disabled)' : 'USER\'S TURN (mic enabled)'}`);
  }, [agentTurn]);
  const [waitingForUserResponse, setWaitingForUserResponse] = useState(false);
  const [seenMessageHashes, setSeenMessageHashes] = useState<Set<string>>(new Set());
  const processedMessageIdsRef = useRef<Set<string>>(new Set()); // Track processed message IDs
  const [isConnecting, setIsConnecting] = useState(false);
  const [audioContextReady, setAudioContextReady] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const agentTurnTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [turnSwitchCountdown, setTurnSwitchCountdown] = useState(0);
  const lastAudioChunkTimeRef = useRef<number>(0);
  const audioInactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastConnectionAttemptRef = useRef<number>(0);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCountRef = useRef(0);
  const currentAgentMessageRef = useRef<string>(""); // Track current message to avoid stale closures
  const processingEventRef = useRef<boolean>(false); // Prevent duplicate event processing
  const conversationStateRef = useRef({
    conversationStarted: false,
    hasReceivedInitialMessage: false
  }); // Track conversation state to avoid stale closures

  // Simple hash function for message content
  const hashMessage = (content: string): string => {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  };

  // Initialize AudioContext on user interaction
  const handleStartInterview = async () => {
    if (!audioContextReady) {
      const success = await initializeGlobalAudioContext();
      if (success) {
        setAudioContextReady(true);
        startAudioPlayback(); // Start playing any queued audio
        setIsReady(true);
      }
    } else {
      startAudioPlayback(); // Already initialized, just start playback
      setIsReady(true);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentAgentMessage]);

  // Auto-start interview on page load ONLY - don't reconnect on mode changes
  useEffect(() => {
    console.log("🔄 [USEEFFECT] Effect triggered - session:", !!session?.user?.id, "isConnecting:", isConnecting);
    if (session?.user?.id && !isConnecting && !eventSourceRef.current) {
      console.log("🔄 [USEEFFECT] Starting initial connection");
      // Add a small delay to prevent rapid reconnections
      const timeoutId = setTimeout(() => {
        console.log("🔄 [USEEFFECT] Timeout fired, calling connectToSSE");
        connectToSSE();
      }, 100);
      
      return () => {
        console.log("🔄 [USEEFFECT] Cleanup - clearing timeout");
        clearTimeout(timeoutId);
      };
    } else {
      console.log("🔄 [USEEFFECT] Skipping connection - already connected or connecting");
    }
  }, [session?.user?.id]); // REMOVED isAudioMode dependency to prevent reconnections

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const checkInterviewCompleteness = async () => {
    if (!session?.user?.id || isCheckingCompleteness) return;

    setIsCheckingCompleteness(true);
    
    // Build conversation history from messages
    let conversationHistory = messages
      .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join('\n\n');
    
    if (currentAgentMessage) {
      conversationHistory += `\n\nAGENT: ${currentAgentMessage}`;
    }

    try {
      const response = await fetch("/api/interview/check-completeness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_history: conversationHistory,
        }),
      });

      if (response.ok) {
        const result = await response.json() as CompletenessResult;
        setCompletenessInfo(result);
        
        if (result.is_complete) {
          setInterviewComplete(true);
          console.log("✅ Interview complete!", result);
        } else {
          // Handle suggested follow-up questions
          const questions = result.suggested_questions;
          if (questions && questions.length > 0) {
            console.log("📋 Reviewer suggested follow-up questions:", questions);
            // The backend has already sent these to the interviewer agent
          }
        }
      }
    } catch (error) {
      console.error("Error checking completeness:", error);
    } finally {
      setIsCheckingCompleteness(false);
    }
  };

  const connectToSSE = () => {
    if (!session?.user?.id || isConnecting) return;

    // Close existing connection
    if (eventSourceRef.current) {
      console.log("🔌 Closing existing SSE connection");
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      // Add a small delay to ensure the connection is fully closed
      setTimeout(() => {
        createNewConnection();
      }, 200);
      return;
    }

    createNewConnection();
  };

  const createNewConnection = () => {
    if (!session?.user?.id || isConnecting) return;
    
    // Prevent rapid reconnections
    const now = Date.now();
    const timeSinceLastAttempt = now - lastConnectionAttemptRef.current;
    const MIN_CONNECTION_INTERVAL = 2000; // 2 seconds between connection attempts
    
    if (timeSinceLastAttempt < MIN_CONNECTION_INTERVAL) {
      console.log(`⏳ Connection attempt too soon (${timeSinceLastAttempt}ms < ${MIN_CONNECTION_INTERVAL}ms) - skipping to prevent duplicates`);
      return;
    }
    
    lastConnectionAttemptRef.current = now;
    
    // Close any existing connection first
    if (eventSourceRef.current) {
      console.log("🔌 Closing existing SSE connection before creating new one");
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsConnecting(true);
    const sseUrl = `/api/interview/stream?userId=${session.user.id}&isAudio=${isAudioMode}`;
    console.log("🔗 Creating new SSE connection:", sseUrl);
    
    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("✅ SSE connection opened");
      console.log("🔗 Connection state - conversationStarted:", conversationStarted, "hasReceivedInitial:", hasReceivedInitialMessage);
      setIsConnected(true);
      setIsConnecting(false);
    };

    eventSource.onmessage = (event) => {
      // Prevent duplicate processing
      if (processingEventRef.current) {
        return;
      }
      
      processingEventRef.current = true;
      
      try {
        const data = JSON.parse(event.data);
        console.log("📨 SSE Event:", data); // Debugging all SSE events

        // Handle agent's suggestion to check for completeness
        if (data.completeness_suggested) {
            console.log("💡 Agent suggested checking for interview completeness.");
            checkInterviewCompleteness();
            return;
        }

        // Handle interview completion via tool call
        if (data.interview_complete) {
            console.log("🎉 Interview completed via tool call!");
            const personalInfoData = data.personal_info_data;
            
            if (personalInfoData) {
                // Save the data to the database (non-blocking)
                fetch("/api/interview/save-personal-info", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        user_id: session?.user?.id,
                        personal_info: personalInfoData
                    }),
                }).then(response => {
                    if (response.ok) {
                        console.log("✅ Personal information saved successfully");
                        setInterviewComplete(true);
                        // The useEffect will handle the redirect
                    } else {
                        console.error("❌ Failed to save personal information");
                    }
                }).catch(error => {
                    console.error("❌ Error saving personal information:", error);
                });
            }
            return;
        }
        
        // Handle turn complete
        if (data.turn_complete) {
          console.log("🏁 Turn complete received - switching to user's turn");
          
          // In audio mode, we might not have accumulated text, so handle differently
          if (isAudioMode) {
            // For audio mode, if we have accumulated text, add it to chat
            if (currentAgentMessageRef.current.trim() && !currentAgentMessageRef.current.includes("🔊")) {
              const messageContent = currentAgentMessageRef.current.trim();
              const messageHash = hashMessage(messageContent);
              const messageId = `agent-${Date.now()}-${messageHash}`;
              
              // Check both hash and ID for stronger duplicate prevention
              if (!seenMessageHashes.has(messageHash) && !processedMessageIdsRef.current.has(messageId)) {
                console.log(`✅ Adding new agent message: "${messageContent.substring(0, 50)}..."`);
                setSeenMessageHashes(prev => new Set([...prev, messageHash]));
                processedMessageIdsRef.current.add(messageId);
                
                setMessages(prev => [...prev, {
                  role: "agent",
                  content: messageContent,
                  timestamp: new Date(),
                  id: messageId
                }]);
              } else {
                console.log(`🚫 Duplicate agent message blocked: "${messageContent.substring(0, 50)}..."`);
              }
            }
            
            // Clear the speaking indicator
            setCurrentAgentMessage("");
            currentAgentMessageRef.current = "";
            
            // Agent finished speaking, now it's user's turn
            console.log("👤 SWITCHING TO USER'S TURN - Agent finished speaking (AUDIO MODE)");
            
            // Clear all timeouts
            if (agentTurnTimeoutRef.current) {
              clearTimeout(agentTurnTimeoutRef.current);
              agentTurnTimeoutRef.current = null;
            }
            if (audioInactivityTimeoutRef.current) {
              clearTimeout(audioInactivityTimeoutRef.current);
              audioInactivityTimeoutRef.current = null;
            }
            
            // Add a small delay to prevent race conditions with audio processing
            setTurnSwitchCountdown(2); // Start countdown from 2 seconds
            
            const countdownInterval = setInterval(() => {
              setTurnSwitchCountdown(prev => {
                if (prev <= 1) {
                  clearInterval(countdownInterval);
                  console.log("✅ Turn switch delay complete - mic now enabled");
                  setAgentTurn(false);
                  setWaitingForUserResponse(true);
                  return 0;
                }
                return prev - 1;
              });
            }, 1000); // Update every second
            
          } else {
            // Text mode - original logic
            if (currentAgentMessageRef.current.trim()) {
              const messageContent = currentAgentMessageRef.current.trim();
              const messageHash = hashMessage(messageContent);
              const messageId = `agent-${Date.now()}-${messageHash}`;
              
              // Check both hash and ID for stronger duplicate prevention
              if (!seenMessageHashes.has(messageHash) && !processedMessageIdsRef.current.has(messageId)) {
                console.log(`✅ Adding new agent message (TEXT): "${messageContent.substring(0, 50)}..."`);
                setSeenMessageHashes(prev => new Set([...prev, messageHash]));
                processedMessageIdsRef.current.add(messageId);
                
                setMessages(prev => [...prev, {
                  role: "agent",
                  content: messageContent,
                  timestamp: new Date(),
                  id: messageId
                }]);
              } else {
                console.log(`🚫 Duplicate agent message blocked (TEXT): "${messageContent.substring(0, 50)}..."`);
              }
              
              currentAgentMessageRef.current = "";
              setCurrentAgentMessage("");
            }
            
            // Agent finished speaking, now it's user's turn
            console.log("👤 SWITCHING TO USER'S TURN - Agent finished speaking (TEXT MODE)");
            setAgentTurn(false);
            setWaitingForUserResponse(true);
          }
          
          return;
        }

        // Handle audio data - play it back
        if (data.mime_type === "audio/pcm" && data.data) {
          const sampleRate = data.sample_rate || 24000;
          
          // If agent is sending audio, it means agent is speaking - disable user input
          if (!agentTurn) {
            console.log("🤖 SWITCHING TO AGENT'S TURN - Agent started speaking (AUDIO)");
            setAgentTurn(true);
            setWaitingForUserResponse(false);
            
            // Safety timeout: If no turn_complete after 30 seconds, force switch to user's turn
            if (agentTurnTimeoutRef.current) {
              clearTimeout(agentTurnTimeoutRef.current);
            }
            agentTurnTimeoutRef.current = setTimeout(() => {
              console.log("⏰ SAFETY TIMEOUT: Agent turn took too long, forcing switch to user's turn");
              setAgentTurn(false);
              setWaitingForUserResponse(true);
            }, 30000);
          }
          
          // Show visual indicator for audio mode
          if (isAudioMode && !currentAgentMessage.includes("🔊")) {
            setCurrentAgentMessage("🔊 [Speaking...]");
          }
          
          // Track when we last received an audio chunk for fallback turn switching
          lastAudioChunkTimeRef.current = Date.now();
          
          // Clear any existing audio inactivity timeout
          if (audioInactivityTimeoutRef.current) {
            clearTimeout(audioInactivityTimeoutRef.current);
          }
          
          // Set a fallback timeout - if no more audio chunks for 3 seconds, assume agent finished
          audioInactivityTimeoutRef.current = setTimeout(() => {
            if (agentTurn) {
              console.log("⏰ FALLBACK: No audio chunks for 3s, assuming agent finished speaking");
              console.log("👤 FALLBACK SWITCHING TO USER'S TURN");
              
              // Start the countdown
              setTurnSwitchCountdown(2);
              const countdownInterval = setInterval(() => {
                setTurnSwitchCountdown(prev => {
                  if (prev <= 1) {
                    clearInterval(countdownInterval);
                    console.log("✅ Fallback turn switch delay complete - mic now enabled");
                    setAgentTurn(false);
                    setWaitingForUserResponse(true);
                    return 0;
                  }
                  return prev - 1;
                });
              }, 1000);
            }
          }, 3000); // 3 seconds of no audio chunks = agent probably finished
          
          try {
            // Create AudioContext on user interaction if not already created
            playPCMAudio(data.data, sampleRate);
          } catch (error) {
            console.error("Error playing audio:", error);
          }
        }

        // Handle text data - accumulate all text chunks until turn_complete
        if (data.mime_type === "text/plain" && data.data) {
          // If agent is sending text, it means agent is speaking - disable user input
          if (!agentTurn) {
            console.log("🤖 SWITCHING TO AGENT'S TURN - Agent started speaking (TEXT)");
            setAgentTurn(true);
            setWaitingForUserResponse(false);
          }
          
          // Update ref immediately to prevent stale closures
          const newMessage = currentAgentMessageRef.current + data.data;
          currentAgentMessageRef.current = newMessage;
          
          // Update state for UI rendering
          setCurrentAgentMessage(newMessage);
          
          // Check if this looks like the initial message and we've already received it
          if (!conversationStateRef.current.conversationStarted && newMessage.toLowerCase().includes("i'm so glad you're here")) {
            if (conversationStateRef.current.hasReceivedInitialMessage) {
              currentAgentMessageRef.current = "";
              setCurrentAgentMessage("");
              return;
            } else {
              setHasReceivedInitialMessage(true);
              setConversationStarted(true);
              conversationStateRef.current.hasReceivedInitialMessage = true;
              conversationStateRef.current.conversationStarted = true;
            }
          }
        }

      } catch (error) {
        console.error("❌ Error parsing SSE data:", error, "Raw data:", event.data);
      } finally {
        // Reset processing flag
        processingEventRef.current = false;
      }
    };

    eventSource.onerror = (error) => {
      console.error("❌ SSE connection error:", error);
      setIsConnected(false);
      setIsConnecting(false);
      
      // Auto-reconnect after 5 seconds (longer delay to prevent connection spam)
      setTimeout(() => {
        if (session?.user?.id && !isConnecting) {
          console.log("🔄 Auto-reconnecting SSE after error...");
          createNewConnection();
        }
      }, 5000);
    };
  };

  const handleAudioData = async (audioData: string, mimeType: string, transcription?: string) => {
    if (!session?.user?.id) return;

    // Clear any existing agent message being typed
    setCurrentAgentMessage("");

    // Add user transcription to chat IMMEDIATELY if available
    if (transcription) {
      const userMessage = {
        role: "user" as const,
        content: transcription,
        timestamp: new Date(),
        id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };
      
      console.log(`✅ Adding user voice message: "${transcription}"`);
      setMessages(prev => [...prev, userMessage]);
    }

    // User is now speaking, agent should wait
    setAgentTurn(true);
    setWaitingForUserResponse(false);
    console.log("🎤 Sending audio data:", mimeType, audioData.length);
    console.log("🤖 Agent's turn - processing user audio");

    try {
      const response = await fetch("/api/interview/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: session.user.id,
          mime_type: mimeType,
          data: audioData,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Audio send failed:", response.status, response.statusText, errorText);
        throw new Error(`Failed to send audio: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log("✅ Audio sent successfully", result);
      
      messageCountRef.current = result.message_count || 0;
      
      // Add a fallback timeout - if no agent response within 10 seconds, switch back to user's turn
      const noResponseTimeout = setTimeout(() => {
        if (agentTurn) {
          console.log("⏰ NO AGENT RESPONSE: 10s timeout, switching back to user's turn");
          setAgentTurn(false);
          setWaitingForUserResponse(true);
          setTurnSwitchCountdown(0);
        }
      }, 10000);
      
      // Clear timeout when component unmounts or agent responds (cleanup after 15s)
      setTimeout(() => clearTimeout(noResponseTimeout), 15000);
      
      // Check completeness if suggested by backend
      if (result.should_check_completeness && !interviewComplete) {
        setTimeout(() => checkInterviewCompleteness(), 2000);
      }
    } catch (error) {
      console.error("❌ Error sending audio:", error);
      
      // Check session status for debugging
      try {
        const statusResponse = await fetch(`/api/interview/session-status?userId=${session.user.id}`);
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          console.log("🔍 Session status:", status);
        }
      } catch (statusError) {
        console.error("Failed to check session status:", statusError);
      }
    }
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

    // User is now speaking, agent should wait
    setAgentTurn(true);
    setWaitingForUserResponse(false);
    console.log("📤 Sending message:", userMessage);
    console.log("🤖 Agent's turn - processing user response");

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
      console.log("✅ Message sent successfully", result);
      
      messageCountRef.current = result.message_count || 0;
      
      // Check completeness if suggested by backend
      if (result.should_check_completeness && !interviewComplete) {
        setTimeout(() => checkInterviewCompleteness(), 2000);
      }
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

  if (!isReady) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-black to-purple-900/20" />
        <div className="relative z-10 text-center p-8">
          <h1 className="text-4xl font-bold mb-4">Life Path Interview</h1>
          <p className="text-xl text-gray-300 mb-8">Share your story to create your visualization.</p>
          <button
            onClick={handleStartInterview}
            className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg text-lg font-semibold hover:from-blue-600 hover:to-purple-700 transition-all duration-300 transform hover:scale-105"
          >
            Click to Start
          </button>
          <p className="text-sm text-gray-500 mt-4">
            (This is required to enable audio)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen bg-black text-white relative overflow-hidden"
    >
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
            <button
              onClick={() => {
                console.log("🔄 Switching modes - current state:", {
                  isAudioMode,
                  conversationStarted,
                  hasReceivedInitialMessage,
                  messagesCount: messages.length
                });
                
                // Only clear audio queue if agent isn't actively speaking
                if (isAgentSpeaking()) {
                  console.log("🚫 [MODE SWITCH] Agent is speaking - protecting audio queue");
                } else {
                  clearAudioQueue(); // Clear any pending audio
                }
                setIsAudioMode(!isAudioMode);
                setIsConnected(false); // Show reconnecting state
                // Don't reset conversation state when switching modes
                // setHasReceivedInitialMessage(false);
                // setConversationStarted(false);
                console.log("🔄 Mode switched, preserving conversation state");
              }}
              className={`px-4 py-2 rounded-lg transition-all duration-200 ${
                isAudioMode
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-white/10 text-gray-400 hover:bg-white/20"
              }`}
              title={isAudioMode ? "Switch to Text Mode" : "Switch to Voice Mode"}
            >
              {isAudioMode ? "🎤 Voice Mode" : "⌨️ Text Mode"}
            </button>
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
              isConnected 
                ? "bg-green-500/20 text-green-400 border border-green-500/30" 
                : "bg-red-500/20 text-red-400 border border-red-500/30"
            }`}>
              {isConnected ? "Connected" : "Connecting..."}
            </div>
            {completenessInfo && (
              <div className="px-3 py-1 rounded-full text-sm font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
                {Math.round(completenessInfo.completeness_score * 100)}% Complete
              </div>
            )}
            <button
              onClick={() => router.push("/life")}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
              disabled={!interviewComplete}
            >
              {interviewComplete ? "View Visualization" : "Complete Interview First"}
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

          {/* Interview Complete Banner */}
          {interviewComplete && (
            <div className="p-4 bg-gradient-to-r from-green-500/20 to-blue-500/20 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-green-400">Interview Complete! 🎉</h3>
                  <p className="text-sm text-gray-300 mt-1">
                    {completenessInfo?.reason || "Great job! We have enough information to create your life path visualization."}
                  </p>
                </div>
                <button
                  onClick={() => router.push("/life")}
                  className="px-6 py-2 bg-gradient-to-r from-green-500 to-blue-600 rounded-lg hover:from-green-600 hover:to-blue-700 transition-all duration-200 font-semibold"
                >
                  Create Visualization →
                </button>
              </div>
            </div>
          )}

          {/* Completeness Info */}
          {completenessInfo && !interviewComplete && (
            <div className="p-4 bg-white/5 border-t border-white/10">
              <div className="text-sm text-gray-400">
                <div className="mb-2">Progress: {Math.round(completenessInfo.completeness_score * 100)}%</div>
                {completenessInfo.areas_covered.length > 0 && (
                  <div className="mb-2">
                    <span className="text-green-400">✓ Covered:</span> {completenessInfo.areas_covered.join(", ")}
                  </div>
                )}
                {completenessInfo.missing_areas.length > 0 && (
                  <div>
                    <span className="text-yellow-400">→ Still needed:</span> {completenessInfo.missing_areas.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="p-6 border-t border-white/10">
            {isAudioMode ? (
              <div className="space-y-3">
                {/* Conversation State Indicator */}
                <div className="text-center mb-3">
                  {agentTurn ? (
                    <div className="text-blue-400 text-sm flex items-center justify-center gap-2">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                      🤖 Agent is thinking/speaking...
                    </div>
                  ) : waitingForUserResponse ? (
                    <div className="text-green-400 text-sm flex items-center justify-center gap-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      🎤 Your turn - Speak now
                    </div>
                  ) : (
                    <div className="text-gray-500 text-sm">
                      Waiting for connection...
                    </div>
                  )}
                </div>
                
                <PCMVoiceRecorder
                  onAudioData={handleAudioData}
                  isConnected={isConnected}
                  disabled={!isConnected || interviewComplete || agentTurn}
                />
                <div className="text-center">
                  <p className="text-xs text-gray-500">
                    {agentTurn 
                      ? (turnSwitchCountdown > 0 
                          ? `Mic available in ${turnSwitchCountdown}s...` 
                          : "Wait for agent to finish speaking...")
                      : "Hold to speak • Release to send • Switch to text mode anytime"
                    }
                  </p>
                  {agentTurn && (
                    <button
                      onClick={() => {
                        console.log("🔧 MANUAL OVERRIDE: Forcing switch to user's turn");
                        setAgentTurn(false);
                        setWaitingForUserResponse(true);
                        setTurnSwitchCountdown(0);
                        if (agentTurnTimeoutRef.current) {
                          clearTimeout(agentTurnTimeoutRef.current);
                          agentTurnTimeoutRef.current = null;
                        }
                      }}
                      className="mt-2 px-3 py-1 text-xs bg-yellow-600/20 border border-yellow-500/30 rounded-lg hover:bg-yellow-600/30 transition-colors"
                    >
                      🔧 Enable Mic (if stuck)
                    </button>
                  )}
                </div>
              </div>
            ) : (
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
                  disabled={!isConnected || interviewComplete}
                />
                <button
                  type="submit"
                  disabled={!isConnected || !currentInput.trim() || interviewComplete}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium"
                >
                  Send
                </button>
              </form>
            )}
            
            {!isAudioMode && (
              <p className="text-xs text-gray-500 mt-3 text-center">
                Press Enter to send • Be authentic and share your genuine experiences
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
    </div>
  );
}