import { LiveServerMessage, Blob } from '@google/genai';

/**
 * Decodes a base64 string into a Uint8Array.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a Uint8Array into a base64 string.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts raw PCM audio data (Uint8Array/Int16Array buffer) to an AudioBuffer.
 * Gemini sends raw PCM 16-bit little-endian.
 */
export function pcmToAudioBuffer(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number = 1
): AudioBuffer {
  // Convert Uint8Array to Int16Array
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Normalize 16-bit integer (-32768 to 32767) to float (-1.0 to 1.0)
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Downsamples audio data from inputRate to outputRate.
 * Uses simple averaging (boxcar filter) which is sufficient for voice.
 */
export function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (outputRate === inputRate) {
    return buffer;
  }
  if (outputRate > inputRate) {
    throw new Error("Upsampling not supported");
  }
  const sampleRatio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / sampleRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRatio);
    // Simple averaging to prevent aliasing artifacts
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

/**
 * Creates a blob suitable for Gemini Live API from Float32Array input (mic).
 * Converts Float32 (-1.0 to 1.0) to Int16 PCM.
 */
export function float32ToPcmBlob(data: Float32Array, sampleRate: number = 16000): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values
    let s = Math.max(-1, Math.min(1, data[i]));
    // Convert to 16-bit PCM
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  return {
    data: encodeBase64(new Uint8Array(int16.buffer)),
    mimeType: `audio/pcm;rate=${sampleRate}`,
  };
}