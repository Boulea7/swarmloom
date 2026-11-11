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
async function openLocal(name: string, chars: number): Promise<string> {
  const local = { name, text: "x".repeat(chars) };
  const error = await resolveSource({ kind: "file", name }, { services: {} as StudioServices, local }).then(
    () => null,
    (e: unknown) => e,
  );
  return error === null ? "" : describeError(error, i18n, ctx);
}

describe("describeError", () => {
  it("explains format-specific size limits in the user's language", async () => {
    expect(await openLocal("big.py", 3 * 1024 * 1024)).toBe("这个文件有 3 MB，这种格式（源代码）最大 2 MB。");
    // Under the format's own limit, nothing is rejected early.
    expect(await openLocal("small.py", 1024)).toBe("");
  });

  it("translates adapter limit errors instead of showing their English message", () => {
    const message = describeError(new RangeError("svg: 900000 elements, over the 200000 limit"), i18n, ctx);
    expect(message).toBe(zhCN["error.tooComplex"]);
  });
});
