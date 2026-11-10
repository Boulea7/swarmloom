import { LevelMeter } from "./levels";

/** Minimal `navigator.mediaDevices` surface needed for microphone input. */
export type MicrophoneSource = Pick<MediaDevices, "getUserMedia">;

/** The page's media devices, or null where capture is unsupported (insecure context, SSR). */
export function defaultMicrophoneSource(): MicrophoneSource | null {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return devices && typeof devices.getUserMedia === "function" ? devices : null;
}

/**
 * Live microphone analysis for the halo finale. The captured stream feeds only an analyser and is
 * never routed to the speakers (no feedback); audio stays on the device.
 */
export class MicrophoneInput {
  readonly meter: LevelMeter;
  readonly #stream: MediaStream;
  readonly #source: MediaStreamAudioSourceNode;
  #stopped = false;

  private constructor(ctx: AudioContext, stream: MediaStream, onEnded: () => void) {
    this.#stream = stream;
    this.meter = new LevelMeter(ctx);
    this.#source = ctx.createMediaStreamSource(stream);
    this.#source.connect(this.meter.node);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (!this.#stopped) onEnded();
      });
    }
  }

  /**
   * Requests the microphone and starts analysing it.
   *
   * @param onEnded Called when the device stops delivering audio (unplugged, permission revoked).
   * @returns The input, or null when access is denied, unavailable or yields no live audio track.
   */
  static async open(
    ctx: AudioContext,
    devices: MicrophoneSource,
    onEnded: () => void,
  ): Promise<MicrophoneInput | null> {
    let stream: MediaStream;
    try {
      // Raw signal: echo cancellation and gain control would flatten the music the halo follows.
      stream = await devices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      return null;
    }
    if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
      stopTracks(stream);
      return null;
    }
    try {
      return new MicrophoneInput(ctx, stream, onEnded);
    } catch {
      stopTracks(stream);
      return null;
    }
  }

  /** Stops capture and releases the device (the browser's recording indicator turns off). */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#source.disconnect();
    this.meter.disconnect();
    stopTracks(this.#stream);
  }
}

/** Stops every track of `stream`. */
export function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
