import { FORMAT_META as REGISTRY } from "@swarmloom/formats/meta";
import { describe, expect, it } from "vitest";
import { acceptAttribute, availableFormats, FORMAT_META, formatOfName } from "../src/formats-meta";
import { guessPasteName } from "../src/source";

describe("format metadata", () => {
  it("mirrors the formats registry: same ids, and every extension opens the same adapter", () => {
    const listed = REGISTRY.filter((f) => f.id !== "dom");
    const ids = listed.map((f) => f.id);
    // Every registry format is known to Studio; optional ones (Lottie) may still be missing there.
    expect(FORMAT_META.map((m) => m.id)).toEqual(expect.arrayContaining(ids));
    expect(ids).toEqual(expect.arrayContaining(FORMAT_META.filter((m) => !m.optional).map((m) => m.id)));
    // Both directions, so an extension the registry drops (legacy .ppt/.xls) cannot linger here.
    const extensions = new Set([
      ...listed.flatMap((f) => f.extensions),
      ...FORMAT_META.filter((m) => !m.optional).flatMap((m) => m.extensions),
    ]);
    for (const ext of extensions) {
      // The registry resolves an extension to its first entry, e.g. .ods to the spreadsheet reader.
      const expected = REGISTRY.find((f) => f.extensions.includes(ext))?.id;
      expect([ext, formatOfName(`file.${ext}`)?.id]).toEqual([ext, expected]);
    }
  });

  it("hides optional formats until the registry provides them", () => {
    const ids = (registry?: string[]) => availableFormats(registry).map((m) => m.id);
    expect(ids()).not.toContain("lottie");
    expect(ids(["markdown"])).not.toContain("lottie");
    expect(ids(["lottie"])).toContain("lottie");
    expect(acceptAttribute(availableFormats()).split(",")).not.toContain(".lottie");
    expect(acceptAttribute(availableFormats()).split(",")).toEqual(expect.arrayContaining([".epub", ".odt", ".cast"]));
  });

  it.each([
    ["diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n", "pasted.patch"],
    [
      '{\n "cells": [\n  {\n   "cell_type": "markdown",\n   "source": ["# Hi"]\n  }\n ],\n "nbformat": 4\n}',
      "pasted.ipynb",
    ],
    ['{"version": 2, "width": 80, "height": 24}\n[0.1, "o", "hi"]\n', "pasted.cast"],
    ['{"name": "swarmloom"}', "pasted.json"],
    ["# Notes\n\n- one\n- two\n", "pasted.md"],
  ])("names a paste by its content: %#", (text, name) => {
    expect(guessPasteName(text)).toBe(name);
  });
});
