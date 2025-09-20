"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { startPCMRecorder, stopMicrophone, convertFloat32ToPCM, pcmToBase64, mergePCMBuffers } from "~/lib/pcmAudio";

interface PCMVoiceRecorderProps {
  onAudioData: (audioData: string, mimeType: string, transcription?: string) => void;
  isConnected: boolean;
  disabled?: boolean;
}

interface AudioQualityResult {
  isValid: boolean;
  reason?: string;
  durationMs: number;
  avgEnergy: number;
}

export default function PCMVoiceRecorder({ 
  onAudioData, 
  isConnected, 
  disabled = false 
}: PCMVoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [isCollecting, setIsCollecting] = useState(false);
  const [bufferLength, setBufferLength] = useState(0);
  
  const recorderNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioBufferRef = useRef<Int16Array[]>([]);
  const silenceCountRef = useRef(0);
  const isCollectingRef = useRef(false);
  const collectStartTimeRef = useRef<number>(0);
  const maxCollectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastBufferUpdateRef = useRef<number>(0);
  const lastAudioLevelUpdateRef = useRef<number>(0);
  const lastVoiceTsRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (maxCollectTimeoutRef.current) {
      clearTimeout(maxCollectTimeoutRef.current);
      maxCollectTimeoutRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      stopMicrophone(micStreamRef.current);
      micStreamRef.current = null;
    }
    recorderNodeRef.current = null;
    audioBufferRef.current = [];
  }, []);

  // Audio level monitoring is now handled inline with voice activity detection

  const startRecording = async () => {
    try {
      setIsRecording(true);
      audioBufferRef.current = [];

      const { recorderNode, audioContext, micStream } = await startPCMRecorder(
        (pcmData: Int16Array) => {
          // Calculate audio level for voice activity detection
          const sum = pcmData.reduce((acc, val) => acc + Math.abs(val), 0);
          const avgLevel = sum / pcmData.length;
          const normalizedLevel = (avgLevel / 32767) * 100;
          
          // Always collect audio - no more cutting in and out
          audioBufferRef.current.push(pcmData);
          
          // Throttle UI updates to prevent performance issues
          const now = Date.now();
          
          // Update visual level every 100ms for smooth but not excessive updates
          if (now - lastAudioLevelUpdateRef.current > 100) {
            setAudioLevel(normalizedLevel);
            lastAudioLevelUpdateRef.current = now;
          }
          
          // Update buffer length every 200ms instead of every frame (60fps)
          if (now - lastBufferUpdateRef.current > 200) {
            setBufferLength(audioBufferRef.current.length);
            lastBufferUpdateRef.current = now;
          }
          
          // Voice activity detection for auto-sending only (not for collection)
          const VOICE_THRESHOLD = 3; // Higher threshold to avoid false positives
          const SILENCE_MS = 5000; // Require 5 seconds of silence before auto-send (more natural)
          const MIN_DURATION_MS = 2000; // Minimum 2s total duration before sending
          
          const nowTs = Date.now();
          if (normalizedLevel > VOICE_THRESHOLD) {
            // Voice detected
            console.log(`🎤 Voice detected: level ${normalizedLevel.toFixed(2)} > ${VOICE_THRESHOLD}`);
            lastVoiceTsRef.current = nowTs;
            if (!isCollectingRef.current) {
              console.log(`🎙️ Starting audio collection`);
              isCollectingRef.current = true;
              collectStartTimeRef.current = nowTs;
              setIsCollecting(true);
              
              // Max cap (15s) to avoid overly long segments
              maxCollectTimeoutRef.current = setTimeout(() => {
                console.log("⏰ Max collect time reached, force sending");
                if (audioBufferRef.current.length > 0) {
                  sendBufferedAudio();
                  resetBuffer();
                }
              }, 15000);
            }
          } else if (isCollectingRef.current) {
            // If enough silence time and min duration reached, send
            const sinceVoiceMs = nowTs - (lastVoiceTsRef.current || nowTs);
            const collectDuration = nowTs - collectStartTimeRef.current;
            
            console.log(`🔇 Silence detected: ${sinceVoiceMs}ms since voice, ${collectDuration}ms total duration`);
            
            if (sinceVoiceMs >= SILENCE_MS && collectDuration >= MIN_DURATION_MS) {
              console.log(`📤 AUTO-SENDING: Silence threshold reached (${sinceVoiceMs}ms >= ${SILENCE_MS}ms)`);
              sendBufferedAudio();
              resetBuffer();
            }
          }
        }
      );
      
      const sendBufferedAudio = () => {
        if (audioBufferRef.current.length === 0) return;
        
        // Combine all audio chunks into one buffer
        const totalLength = audioBufferRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedAudio = new Int16Array(totalLength);
        let offset = 0;
        
        for (const chunk of audioBufferRef.current) {
          combinedAudio.set(chunk, offset);
          offset += chunk.length;
        }
        
        // Send the complete audio segment with placeholder transcription
        const base64Data = pcmToBase64(combinedAudio);
        const transcription = `[Voice message - ${Math.round(combinedAudio.length / 16000 * 1000)}ms]`;
        onAudioData(base64Data, "audio/pcm", transcription);
        console.log(`📤 Sent audio segment: ${combinedAudio.length} samples`);
      };
      
      const resetBuffer = () => {
        audioBufferRef.current = [];
        silenceCountRef.current = 0;
        isCollectingRef.current = false;
        collectStartTimeRef.current = 0;
        setIsCollecting(false);
        setBufferLength(0);
        
        // Clear timeout
        if (maxCollectTimeoutRef.current) {
          clearTimeout(maxCollectTimeoutRef.current);
          maxCollectTimeoutRef.current = null;
        }
      };

      recorderNodeRef.current = recorderNode;
      audioContextRef.current = audioContext;
      micStreamRef.current = micStream;
      setSampleRate(audioContext.sampleRate);

      // Audio level monitoring is now handled inline with voice activity detection

      console.log(`✅ PCM recording started: ${audioContext.sampleRate}Hz → 16kHz (resampled)`);
    } catch (error) {
      console.error("❌ Error starting PCM recording:", error);
      setIsRecording(false);
      alert("Unable to access microphone. Please check permissions and try again.");
    }
  };

  const stopRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      setAudioLevel(0);
      setIsCollecting(false);
      cleanup();
      console.log("🛑 PCM recording stopped");
    }
  };
  
  const validateAudioQuality = (audioData: Int16Array): AudioQualityResult => {
    const durationMs = Math.round(audioData.length / 16000 * 1000);
    
    // Calculate audio energy to detect if it's meaningful speech
    let totalEnergy = 0;
    for (let i = 0; i < audioData.length; i++) {
      totalEnergy += Math.abs(audioData[i]);
    }
    const avgEnergy = totalEnergy / audioData.length;
    
    const MIN_AUDIO_DURATION = 800; // 800ms for complete words
    const MIN_ENERGY = 100; // Minimum average energy for meaningful speech
    
    if (durationMs < MIN_AUDIO_DURATION) {
      return {
        isValid: false,
        reason: `Too short (${durationMs}ms < ${MIN_AUDIO_DURATION}ms) - likely cut-off speech`,
        durationMs,
        avgEnergy
      };
    }
    
    if (avgEnergy < MIN_ENERGY) {
      return {
        isValid: false,
        reason: `Too quiet (energy: ${avgEnergy.toFixed(1)} < ${MIN_ENERGY}) - likely incomplete speech`,
        durationMs,
        avgEnergy
      };
    }
    
    return {
      isValid: true,
      durationMs,
      avgEnergy
    };
  };

  const sendCurrentBuffer = () => {
    if (audioBufferRef.current.length === 0) return;
    
    // Combine all audio chunks into one buffer
    const totalLength = audioBufferRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedAudio = new Int16Array(totalLength);
    let offset = 0;
    
    for (const chunk of audioBufferRef.current) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Check audio quality for logging, but always send the audio
    const qualityCheck = validateAudioQuality(combinedAudio);
    
    if (!qualityCheck.isValid) {
      // Silently discard without user notification - this prevents agent from getting stuck
      console.log(`🗑️ Silently discarding problematic audio: ${qualityCheck.reason}`);
      
      // Reset buffer without sending - user doesn't need to know
      audioBufferRef.current = [];
      silenceCountRef.current = 0;
      isCollectingRef.current = false;
      collectStartTimeRef.current = 0;
      setIsCollecting(false);
      setBufferLength(0);
      return;
    }
    
    // Send good quality audio
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(combinedAudio.buffer)));
    const transcription = `[Voice message - ${qualityCheck.durationMs}ms]`;
    onAudioData(base64Data, "audio/pcm", transcription);
    console.log(`📤 Sent audio segment: ${combinedAudio.length} samples (${qualityCheck.durationMs}ms)`);
    
    // Reset buffer
    audioBufferRef.current = [];
    silenceCountRef.current = 0;
    isCollectingRef.current = false;
    collectStartTimeRef.current = 0;
    setIsCollecting(false);
    setBufferLength(0);
    
    // Clear timeout
    if (maxCollectTimeoutRef.current) {
      clearTimeout(maxCollectTimeoutRef.current);
      maxCollectTimeoutRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Stop recording when disabled
  useEffect(() => {
    console.log(`🎛️ PCMVoiceRecorder disabled state changed: ${disabled}, isRecording: ${isRecording}`);
    if (disabled && isRecording) {
      console.log("🛑 Stopping recording because component was disabled");
      stopRecording();
    }
  }, [disabled, isRecording, stopRecording]);

  const canRecord = isConnected && !disabled;

  return (
    <div className="flex items-center space-x-3">
      {/* Record Button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={!canRecord}
        className={`relative w-12 h-12 rounded-full transition-all duration-200 flex items-center justify-center ${
          isRecording
            ? "bg-red-500 hover:bg-red-600"
            : canRecord
            ? "bg-blue-500 hover:bg-blue-600"
            : "bg-gray-500 cursor-not-allowed"
        }`}
      >
        {isRecording ? (
          <div className="w-4 h-4 bg-white rounded-sm" />
        ) : (
          <svg
            className="w-6 h-6 text-white"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
              clipRule="evenodd"
            />
          </svg>
        )}
        
        {/* Recording indicator ring */}
        {isRecording && (
          <div className="absolute inset-0 rounded-full border-2 border-red-300 animate-ping" />
        )}
      </button>
      
      {/* Manual Send Button */}
      {isRecording && bufferLength > 0 && (
        <button
          onClick={sendCurrentBuffer}
          className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded-full transition-colors duration-200"
        >
          Send Now ({Math.round(bufferLength / 60)}s) {/* Approximate seconds based on 60fps */}
        </button>
      )}

      {/* Real-time Audio Level Indicator */}
      {isRecording && (
        <div className="flex items-center space-x-1">
          <div className="flex space-x-1 items-end h-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`w-1 bg-blue-400 rounded-full transition-all duration-100 ${
                  audioLevel > (i * 20) ? 'opacity-100' : 'opacity-30'
                }`}
                style={{
                  height: `${Math.max(4, Math.min(32, (audioLevel / 100) * 32))}px`
                }}
              />
            ))}
          </div>
          <span className="text-xs text-green-400 ml-2 font-medium">
            🎙️ Live PCM • {sampleRate}Hz→16kHz {isCollecting && "• 🔊 Voice Detected"}
          </span>
        </div>
      )}

      {/* Status Text */}
      {!isRecording && (
        <span className="text-xs text-gray-400">
          {canRecord ? "Click for continuous voice recording (auto-sends on pause)" : "Voice disabled"}
        </span>
      )}
      
      {/* Continuous Recording Indicator */}
      {isRecording && (
        <div className="text-xs text-blue-400 mt-2">
          📡 Continuous recording • Speak naturally • Auto-sends after pauses
        </div>
      )}
    </div>
  );
}
