import { createI18n } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { describeError } from "../src/errors";
import { createStudioI18n } from "../src/i18n";
import { zhCN } from "../src/i18n/messages/zh-CN";
import type { StudioServices } from "../src/services";
import { resolveSource } from "../src/source";

const i18n = createStudioI18n("zh-CN", zhCN, createI18n("zh-CN"));
const ctx = { formats: "源代码", label: "big.py" };

/** Error message for a local text file opened in the Chinese UI. */
async function openLocal(name: string, chars: number, head = ""): Promise<string> {
  const local = { name, text: head + "x".repeat(chars) };
  const error = await resolveSource({ kind: "file", name }, { services: {} as StudioServices, local }).then(
    () => null,
    (e: unknown) => e,
  );
  return error === null ? "" : describeError(error, i18n, ctx);
}

describe("describeError", () => {
  it("explains format-specific size limits in the user's language", async () => {
    expect(await openLocal("big.py", 3 * 1024 * 1024)).toBe("这个文件有 3 MB，这种格式（源代码）最大 2 MB。");
    // Second-wave formats: the adapter's own limit, and the name from Studio's catalog.
    expect(await openLocal("big.patch", 17 * 1024 * 1024)).toBe("这个文件有 17 MB，这种格式（补丁）最大 16 MB。");
    // Under the format's own limit, nothing is rejected early.
    expect(await openLocal("small.py", 1024)).toBe("");
    // Lottie JSON keeps its .json name; its content, not the code limit, decides.
    const lottie = '{"v":"5.12.0","fr":30,"ip":0,"op":60,"layers":[],"nm":"';
    expect(await openLocal("loop.json", 3 * 1024 * 1024, lottie)).toBe("");
  });

  it("translates adapter limit errors instead of showing their English message", () => {
    const message = describeError(new RangeError("svg: 900000 elements, over the 200000 limit"), i18n, ctx);
    expect(message).toBe(zhCN["error.tooComplex"]);
  });

  it("translates Lottie adapter errors by code instead of showing their English message", () => {
    // Shape of `LottieError` from @swarmloom/adapter-lottie (name + code; English message).
    const lottie = (code: string) =>
      Object.assign(new Error("This animation moves only through After Effects expressions."), {
        name: "LottieError",
        code,
      });
    expect(describeError(lottie("unsupported"), i18n, ctx)).toBe(zhCN["error.lottieExpressions"]);
    expect(describeError(lottie("too-large"), i18n, ctx)).toBe(zhCN["error.tooComplex"]);
  });
});
