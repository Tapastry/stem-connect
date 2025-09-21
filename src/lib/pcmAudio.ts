/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-inferrable-types */
/**
 * PCM Audio utilities for voice recording and streaming
 */

export interface PCMRecorderResult {
  recorderNode: AudioWorkletNode;
  audioContext: AudioContext;
  micStream: MediaStream;
}

/**
 * Convert Float32Array audio data to PCM16 (Int16Array)
 */
export function convertFloat32ToPCM(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const value = float32Array[i] ?? 0;
    // Clamp the value to [-1, 1] range
    const clamped = Math.max(-1, Math.min(1, value));
    // Convert to 16-bit PCM
    int16Array[i] = Math.round(clamped * 32767);
  }
  return int16Array;
}

/**
 * Start PCM audio recorder with AudioWorklet
 */
export async function startPCMRecorder(
  onDataCallback: (pcmData: Int16Array) => void,
  targetSampleRate: number = 16000,
): Promise<PCMRecorderResult> {
  // Request microphone access
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // Create audio context with default sample rate to match the microphone
  const audioContext = new AudioContext();
  const actualSampleRate = audioContext.sampleRate;
  const resampleRatio = actualSampleRate / targetSampleRate;

  console.log(
    `Audio context sample rate: ${actualSampleRate}Hz, target: ${targetSampleRate}Hz, ratio: ${resampleRatio}`,
  );

  // Create the AudioWorklet processor inline with resampling
  const processorCode = `
    class PCMProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.bufferSize = 1024;
        this.buffer = [];
        this.resampleRatio = ${resampleRatio};
        this.resampleCounter = 0;
      }
      
      process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
          const channelData = input[0]; // Mono channel
          
          // Downsample by taking every nth sample
          for (let i = 0; i < channelData.length; i++) {
            this.resampleCounter += 1;
            if (this.resampleCounter >= this.resampleRatio) {
              this.buffer.push(channelData[i]);
              this.resampleCounter = 0;
            }
          }
          
          // When buffer is full, send it
          while (this.buffer.length >= this.bufferSize) {
            const chunk = this.buffer.splice(0, this.bufferSize);
            this.port.postMessage({
              type: 'audio',
              data: new Float32Array(chunk)
            });
          }
        }
        return true; // Keep processor alive
      }
    }
    
    registerProcessor('pcm-processor', PCMProcessor);
  `;

  // Create a blob URL for the processor
  const blob = new Blob([processorCode], { type: "application/javascript" });
  const processorUrl = URL.createObjectURL(blob);

  // Add the processor module
  await audioContext.audioWorklet.addModule(processorUrl);

  // Clean up the blob URL
  URL.revokeObjectURL(processorUrl);

  // Create the worklet node
  const recorderNode = new AudioWorkletNode(audioContext, "pcm-processor");

  // Handle messages from the processor
  recorderNode.port.onmessage = (event) => {
    if (event.data.type === "audio") {
      const float32Data = event.data.data;
      const pcmData = convertFloat32ToPCM(float32Data);
      onDataCallback(pcmData);
    }
  };

  // Connect microphone to the worklet
  const source = audioContext.createMediaStreamSource(micStream);
  source.connect(recorderNode);

  return { recorderNode, audioContext, micStream };
}

/**
 * Stop the microphone stream
 */
export function stopMicrophone(micStream: MediaStream): void {
  micStream.getTracks().forEach((track) => track.stop());
}

/**
 * Convert PCM16 data to base64 for transmission
 */
export function pcmToBase64(pcmData: Int16Array): string {
  const buffer = new ArrayBuffer(pcmData.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < pcmData.length; i++) {
    // Ensure pcmData[i] is a number before passing to setInt16
    view.setInt16(i * 2, Number(pcmData[i]), true); // Little-endian
  }

  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(buffer);
  // Use String.fromCharCode with spread and apply for better performance and to avoid type issues
  // Also, handle large arrays by chunking to avoid stack overflow
  let binary = "";
  const chunkSize = 0x8000; // 32k chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[],
    );
  }
  return btoa(binary);

  /**
   * Merge multiple PCM buffers into one
   */
  function mergePCMBuffers(buffers: Int16Array[]): Int16Array {
    const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
    const result = new Int16Array(totalLength);

    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }

    return result;
  }

  // Global audio queue for sequential playback
  let audioQueue: Array<() => Promise<void>> = [];
  let isPlaying = false;
  let globalAudioContext: AudioContext | null = null;
  let isAudioInitialized = false;
  let agentSpeaking = false; // Track if agent is actively speaking

  /**
   * Initialize the global AudioContext. Must be called after a user gesture.
   */
  async function initializeGlobalAudioContext(): Promise<boolean> {
    if (globalAudioContext && globalAudioContext.state === "running") {
      isAudioInitialized = true;
      return true;
    }
    try {
      globalAudioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      if (globalAudioContext.state === "suspended") {
        await globalAudioContext.resume();
      }
      isAudioInitialized = globalAudioContext.state === "running";
      return isAudioInitialized;
    } catch (error) {
      console.error("Failed to initialize global AudioContext:", error);
      globalAudioContext = null;
      isAudioInitialized = false;
      return false;
    }
  }

  /**
   * Starts processing the audio queue. Should be called after initialization.
   */
  function startAudioPlayback() {
    if (!isAudioInitialized) {
      console.error("Audio not initialized. Cannot start playback.");
      return;
    }
    processAudioQueue();
  }

  async function processAudioQueue() {
    if (isPlaying || audioQueue.length === 0 || !isAudioInitialized) return;

    isPlaying = true;
    console.log(`Starting to process ${audioQueue.length} audio chunks`);

    while (audioQueue.length > 0) {
      const playFunction = audioQueue.shift()!;
      console.log(`Playing chunk ${audioQueue.length + 1} of original queue`);
      await playFunction();
    }

    isPlaying = false;
    agentSpeaking = false; // Agent finished speaking
    console.log(`All audio chunks completed - agent finished speaking`);
  }

  /**
   * Clear the audio queue (useful when switching modes or ending conversation)
   */
  /**
   * Check if the agent is currently speaking
   */
  function isAgentSpeaking(): boolean {
    return agentSpeaking || isPlaying || audioQueue.length > 0;
  }

  function clearAudioQueue(force: boolean = false): void {
    if (agentSpeaking && !force) {
      console.log(
        `Cannot clear audio queue - agent is actively speaking (${audioQueue.length} chunks protected)`,
      );
      return;
    }

    console.log(
      `Clearing audio queue - ${audioQueue.length} chunks discarded${force ? " (FORCED)" : ""}`,
    );
    audioQueue = [];
    isPlaying = false;
    agentSpeaking = false;
  }

  /**
   * Play PCM audio data through the speakers with queuing
   */
  async function playPCMAudio(
    base64Data: string,
    sampleRate: number = 24000,
  ): Promise<void> {
    return new Promise((resolve) => {
      // Mark agent as speaking when audio is queued
      agentSpeaking = true;

      // Add to queue instead of playing immediately
      audioQueue.push(async () => {
        await playPCMAudioImmediate(base64Data, sampleRate);
        resolve();
      });

      // Process queue
      processAudioQueue();
    });
  }

  /**
   * Internal function to play audio immediately (not queued)
   */
  async function playPCMAudioImmediate(
    base64Data: string,
    sampleRate: number = 24000,
  ): Promise<void> {
    if (!globalAudioContext || globalAudioContext.state !== "running") {
      // This can happen if the context is suspended by the browser.
      // We don't log an error here to avoid console spam, as initialization is handled elsewhere.
      return;
    }

    try {
      // Decode base64 to binary
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert bytes to Int16Array (PCM16) - little endian
      const pcmData = new Int16Array(bytes.buffer);

      // Convert PCM16 to Float32 for Web Audio API with proper normalization
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        // Normalize 16-bit PCM to -1.0 to 1.0 range
        // 32768 instead of 32767 to handle -32768 correctly
        float32Data[i] = Math.max(-1, Math.min(1, (pcmData?.[i] ?? 0) / 32768));
      }

      // Create audio buffer with the specified sample rate
      const audioBuffer = globalAudioContext.createBuffer(
        1,
        float32Data.length,
        sampleRate,
      );
      audioBuffer.getChannelData(0).set(float32Data);

      // Play the audio and wait for completion
      return new Promise<void>((resolve) => {
        const source = globalAudioContext!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(globalAudioContext!.destination);

        // Add event listeners for debugging
        source.onended = () => {
          console.log(`Audio chunk finished playing`);
          resolve(); // Resolve when playback actually ends
        };

        console.log(`Starting audio chunk playback`);
        source.start();
      });
    } catch (error) {
      console.error("Error playing PCM audio:", error);
      console.error("Stack trace:", (error as Error).stack);
      throw error;
    }
  }
}
