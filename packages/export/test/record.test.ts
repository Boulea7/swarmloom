import { describe, expect, it, vi } from "vitest";
import { type RecordEnv, RecordingError, recordWith } from "../src/index";

class FakeTrack extends EventTarget {
  stopped = false;
  readonly kind: string;
  constructor(
    kind: string,
    readonly crop: (target: unknown) => Promise<void> = async () => undefined,
  ) {
    super();
    this.kind = kind;
  }
  cropTo(target: unknown): Promise<void> {
    return this.crop(target);
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeRecorder extends EventTarget {
  static isTypeSupported = (type: string) => type === "video/webm;codecs=vp8,opus";
  state = "inactive";
  constructor(readonly stream: { tracks: FakeTrack[] }) {
    super();
  }
  start(): void {
    this.state = "recording";
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["abc"]) }));
  }
  stop(): void {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

function env(video: FakeTrack, audio: FakeTrack[] = []): RecordEnv & { streams: { tracks: FakeTrack[] }[] } {
  const streams: { tracks: FakeTrack[] }[] = [];
  const capture = {
    getTracks: () => [video, ...audio],
    getVideoTracks: () => [video],
    getAudioTracks: () => audio,
  };
  return {
    streams,
    getDisplayMedia: async () => capture as unknown as MediaStream,
    CropTarget: { fromElement: async () => "crop-target" },
    MediaRecorder: FakeRecorder as unknown as RecordEnv["MediaRecorder"],
    createStream: (tracks) => {
      const stream = { tracks: tracks as unknown as FakeTrack[] };
      streams.push(stream);
      return stream as unknown as MediaStream;
    },
  };
}

describe("recordElement", () => {
  it("fails clearly where capture APIs are missing", async () => {
    const target = document.body;
    const missing: RecordEnv[] = [
      { createStream: () => new EventTarget() as unknown as MediaStream },
      { ...env(new FakeTrack("video")), CropTarget: undefined },
      { ...env(new FakeTrack("video")), MediaRecorder: undefined },
    ];
    for (const e of missing) {
      const error = await recordWith(e, target).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(RecordingError);
      expect((error as RecordingError).code).toBe("unsupported");
      expect((error as Error).message).toContain("npx swarmloom render");
    }
  });

  it("crops to the element, mixes tab audio and stops when the share ends", async () => {
    const crop = vi.fn(async () => undefined);
    const video = new FakeTrack("video", crop);
    const tabAudio = new FakeTrack("audio");
    const e = env(video, [tabAudio]);
    const recording = await recordWith(e, document.body);
    expect(crop).toHaveBeenCalledWith("crop-target");
    expect(recording.mimeType).toBe("video/webm;codecs=vp8,opus");
    expect(e.streams[0]?.tracks).toEqual([video, tabAudio]);

    video.dispatchEvent(new Event("ended"));
    const blob = await recording.result;
    expect(blob.type).toBe("video/webm;codecs=vp8,opus");
    expect(await blob.text()).toBe("abc");
    expect(video.stopped && tabAudio.stopped).toBe(true);
  });

  it("stops the capture when it cannot be cropped (another tab was shared)", async () => {
    const video = new FakeTrack("video", () =>
      Promise.reject(new DOMException("not self-capture", "NotSupportedError")),
    );
    const error = await recordWith(env(video), document.body).catch((err: unknown) => err);
    expect((error as RecordingError).code).toBe("wrong-surface");
    expect(video.stopped).toBe(true);
  });
});
