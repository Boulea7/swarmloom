/** The parts of an `AudioBuffer` the encoder reads; a real `AudioBuffer` satisfies it. */
export type PcmSource = Pick<AudioBuffer, "numberOfChannels" | "length" | "sampleRate" | "getChannelData">;

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
/** RIFF sizes are unsigned 32-bit; the RIFF chunk size field covers everything after its first 8 bytes. */
const MAX_DATA_BYTES = 0xffffffff - (HEADER_BYTES - 8);

function validate(buffer: PcmSource): void {
  if (typeof buffer !== "object" || buffer === null || typeof buffer.getChannelData !== "function") {
    throw new TypeError("encodeWav() needs an AudioBuffer");
  }
  const { numberOfChannels: channels, length, sampleRate } = buffer;
  if (!Number.isInteger(channels) || channels < 1 || channels > 0xffff) {
    throw new RangeError(`encodeWav() needs 1..65535 channels, got ${channels}`);
  }
  if (!Number.isInteger(length) || length < 0) throw new RangeError(`invalid AudioBuffer length ${length}`);
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) {
    throw new RangeError(`encodeWav() needs an integer sample rate, got ${sampleRate}`);
  }
  if (length * channels * BYTES_PER_SAMPLE > MAX_DATA_BYTES) {
    throw new RangeError("audio is too long for a WAV file (4 GiB limit)");
  }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Float sample -> signed 16-bit, clipped to [-1, 1]; NaN becomes silence. */
function toInt16(sample: number): number {
  if (Number.isNaN(sample)) return 0;
  const s = Math.min(Math.max(sample, -1), 1);
  return Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
}

/**
 * Encodes audio as a 16-bit PCM RIFF/WAVE file.
 *
 * Every channel of the buffer is written, interleaved (stereo output of `renderOffline` becomes a
 * standard stereo WAV). Samples are clipped to [-1, 1] and rounded; NaN samples become silence.
 *
 * @param buffer Audio to encode; any object with the `AudioBuffer` shape works.
 * @returns The complete `.wav` file bytes (44-byte header + interleaved little-endian PCM).
 * @throws TypeError when `buffer` is not buffer-like; RangeError for an invalid channel count,
 *   length or sample rate, or when the data would exceed the 4 GiB RIFF limit.
 */
export function encodeWav(buffer: PcmSource): Uint8Array {
  validate(buffer);
  const { numberOfChannels: channels, length, sampleRate } = buffer;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const dataBytes = length * blockAlign;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size for PCM
  view.setUint16(20, 1, true); // audio format: integer PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const samples = buffer.getChannelData(c);
    if (samples.length < length) throw new RangeError(`channel ${c} has ${samples.length} samples, expected ${length}`);
    data.push(samples);
  }
  let offset = HEADER_BYTES;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      view.setInt16(offset, toInt16(data[c][i]), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}
