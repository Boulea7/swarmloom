import { describe, expect, it } from "vitest";
import { parsePullUrl, pullDiffUrl } from "../src/github";
import {
  createDiffAdapter,
  DiffError,
  type DiffLineData,
  decodeHeader,
  diffAdapter,
  LINE_TASK,
  labelAuthors,
  looksLikePatch,
  parseAuthor,
  parsePatch,
  readLineData,
} from "../src/index";

const ctx = { document, width: 900, theme: "light" as const };

const UNIFIED = `--- old/hello.c\t2024-01-01 10:00:00
+++ new/hello.c\t2024-01-02 10:00:00
@@ -1,4 +1,4 @@
 #include <stdio.h>
-int main() {
+int main(void) {
   puts("hi");
 }
`;

const NO_NEWLINE = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 line one
-last line
\\ No newline at end of file
+last line
`;

const RENAME = `diff --git a/src/old name.ts b/src/new name.ts
similarity index 92%
rename from src/old name.ts
rename to src/new name.ts
index 3333333..4444444 100644
--- a/src/old name.ts
+++ b/src/new name.ts
@@ -3 +3 @@ export function f() {
-  return 1;
+  return 2;
diff --git a/docs/a.md b/docs/b.md
similarity index 100%
rename from docs/a.md
rename to docs/b.md
`;

const BINARY = `diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/logo.png differ
diff --git a/icon.bin b/icon.bin
index 6666666..7777777 100644
GIT binary patch
literal 12
TcmZ?wbhEHbWMyDvU|<9Q0XYBx

literal 0
HcmV?d00001

diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`;

const ADD_DELETE = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..8888888
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+first
+second
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 9999999..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

const LOG = `commit 0123456789abcdef0123456789abcdef01234567
Author: Ada Lovelace <ada@example.org>
Date:   Mon Jan 1 10:00:00 2024 +0000

    Tune the engine

    Second paragraph of the message.

diff --git a/engine.txt b/engine.txt
index 1..2 100644
--- a/engine.txt
+++ b/engine.txt
@@ -1 +1 @@
-slow
+fast

commit fedcba9876543210fedcba9876543210fedcba98
Author: Grace Hopper <grace@example.org>
Date:   Tue Jan 2 10:00:00 2024 +0000

    Merge branch 'x'

commit 1111111111111111111111111111111111111111
Author: Ada Lovelace <ADA@example.org>
Date:   Wed Jan 3 10:00:00 2024 +0000

    Follow-up

diff --git a/engine.txt b/engine.txt
--- a/engine.txt
+++ b/engine.txt
@@ -1 +1 @@
-fast
+faster
`;

const MBOX = `From 2222222222222222222222222222222222222222 Mon Sep 17 00:00:00 2001
From: =?UTF-8?q?Ren=C3=A9=20Descartes?= <rene@example.org>
Date: Thu, 4 Jan 2024 10:00:00 +0100
Subject: [PATCH 1/2] Think, therefore
 patch

Body text.
---
 cogito.txt | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

diff --git a/cogito.txt b/cogito.txt
--- a/cogito.txt
+++ b/cogito.txt
@@ -1,2 +1,2 @@
-- dubito
+- cogito
 -- ergo sum
--
2.43.0

From 3333333333333333333333333333333333333333 Mon Sep 17 00:00:00 2001
From: Rene Descartes <rene@example.org>
Date: Thu, 4 Jan 2024 11:00:00 +0100
Subject: [PATCH 2/2] Second

---
diff --git a/b.txt b/b.txt
--- a/b.txt
+++ b/b.txt
@@ -1 +1,2 @@
 x
+y
--
2.43.0
`;

describe("parsePatch", () => {
  it("reads a plain unified diff with timestamps and line numbers", () => {
    const p = parsePatch(UNIFIED);
    expect(p.kind).toBe("unified");
    const f = p.commits[0]?.files[0];
    expect(f).toMatchObject({ oldPath: "old/hello.c", newPath: "new/hello.c", status: "renamed" });
    const lines = f?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => l.kind)).toEqual(["context", "del", "add", "context", "context"]);
    expect(lines.map((l) => [l.oldNo, l.newNo])).toEqual([
      [1, 1],
      [2, undefined],
      [undefined, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it("marks lines without a newline at end of file", () => {
    const lines = parsePatch(NO_NEWLINE).commits[0]?.files[0]?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => [l.kind, l.text, l.noNewline ?? false])).toEqual([
      ["context", "line one", false],
      ["del", "last line", true],
      ["add", "last line", false],
    ]);
  });

  it("reads renames with spaces, similarity and pure renames", () => {
    const [a, b] = parsePatch(RENAME).commits[0]?.files ?? [];
    expect(a).toMatchObject({
      oldPath: "src/old name.ts",
      newPath: "src/new name.ts",
      status: "renamed",
      similarity: 92,
    });
    expect(a?.hunks[0]).toMatchObject({
      oldStart: 3,
      oldLines: 1,
      newStart: 3,
      newLines: 1,
      section: "export function f() {",
    });
    expect(b).toMatchObject({
      oldPath: "docs/a.md",
      newPath: "docs/b.md",
      status: "renamed",
      similarity: 100,
      hunks: [],
    });
  });

  it("reads binary markers, GIT binary patches and mode changes", () => {
    const files = parsePatch(BINARY).commits[0]?.files ?? [];
    expect(files.map((f) => [f.newPath, f.status, f.binary])).toEqual([
      ["logo.png", "added", true],
      ["icon.bin", "modified", true],
      ["run.sh", "modified", false],
    ]);
    expect(files[2]).toMatchObject({ oldMode: "100644", newMode: "100755" });
  });

  it("reads added and deleted files", () => {
    const [added, deleted] = parsePatch(ADD_DELETE).commits[0]?.files ?? [];
    expect(added).toMatchObject({ oldPath: null, newPath: "new.txt", status: "added" });
    expect(added?.hunks[0]?.lines.map((l) => l.newNo)).toEqual([1, 2]);
    expect(deleted).toMatchObject({ oldPath: "gone.txt", newPath: null, status: "deleted" });
  });

  it("reads git log -p with authors, messages and merge commits without diffs", () => {
    const p = parsePatch(LOG);
    expect(p.kind).toBe("log");
    expect(p.commits.map((c) => [c.id?.slice(0, 7), c.author?.name, c.subject, c.files.length])).toEqual([
      ["0123456", "Ada Lovelace", "Tune the engine", 1],
      ["fedcba9", "Grace Hopper", "Merge branch 'x'", 0],
      ["1111111", "Ada Lovelace", "Follow-up", 1],
    ]);
    expect(p.commits[0]?.body).toBe("Second paragraph of the message.");
    expect(p.commits[0]?.date).toBe("Mon Jan 1 10:00:00 2024 +0000");
  });

  it("reads format-patch mailboxes: encoded names, folded subjects, '-- ' content and signatures", () => {
    const p = parsePatch(MBOX);
    expect(p.kind).toBe("mbox");
    expect(p.commits).toHaveLength(2);
    const [one, two] = p.commits;
    expect(one?.author).toEqual({ name: "René Descartes", email: "rene@example.org" });
    expect(one?.subject).toBe("Think, therefore patch");
    expect(one?.body).toBe("Body text.");
    // "-- dubito" is a removed line "- dubito", not a signature separator.
    expect(one?.files[0]?.hunks[0]?.lines.map((l) => [l.kind, l.text])).toEqual([
      ["del", "- dubito"],
      ["add", "- cogito"],
      ["context", "-- ergo sum"],
    ]);
    expect(two?.files[0]?.hunks[0]?.lines.map((l) => l.kind)).toEqual(["context", "add"]);
  });

  it("flags hunks cut short and keeps going", () => {
    const p = parsePatch(
      "--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n a\n-b\ndiff --git a/y b/y\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-1\n+2\n",
    );
    const [x, y] = p.commits[0]?.files ?? [];
    expect(x?.hunks[0]?.incomplete).toBe(true);
    expect(y?.hunks[0]?.lines).toHaveLength(2);
  });

  it("applies file and line limits", () => {
    const many = Array.from({ length: 5 }, (_, i) => `--- a/f${i}\n+++ b/f${i}\n@@ -1 +1 @@\n-a\n+b\n`).join("");
    const p = parsePatch(many, { maxFiles: 2 });
    expect(p.commits[0]?.files).toHaveLength(2);
    expect(p.dropped).toBeGreaterThan(0);
    const q = parsePatch(many, { maxLines: 3 });
    expect(q.commits[0]?.files.flatMap((f) => f.hunks.flatMap((h) => h.lines))).toHaveLength(3);
    expect(q.dropped).toBe(7);
  });

  const rejects: [string, string, RegExp][] = [
    ["empty", "", /no file changes/],
    ["prose", "hello\nworld\n", /no file changes/],
    ["binary bytes", "diff --git a/x b/x\u0000", /binary data/],
    ["header only", "commit 0123456\nAuthor: A <a@b>\n\n    msg\n", /no file changes/],
  ];
  it.each(rejects)("rejects: %s", (_name, source, message) => {
    expect(() => parsePatch(source)).toThrow(DiffError);
    expect(() => parsePatch(source)).toThrow(message);
  });
});

describe("helpers", () => {
  it("decodes RFC 2047 words and author headers", () => {
    expect(decodeHeader("=?UTF-8?b?w6ljbGFpcg==?= and =?UTF-8?q?caf=C3=A9?=")).toBe("éclair and café");
    expect(parseAuthor("Plain Name")).toEqual({ name: "Plain Name" });
    expect(parseAuthor('"Quoted, Name" <q@example.org>')).toEqual({ name: "Quoted, Name", email: "q@example.org" });
  });

  it("maps authors to one label each, or anonymises them", () => {
    const p = parsePatch(LOG);
    const named = labelAuthors(p.commits);
    expect(p.commits.map((c) => named.get(c)?.label)).toEqual(["Ada Lovelace", "Grace Hopper", "Ada Lovelace"]);
    const anon = labelAuthors(p.commits, true);
    expect(p.commits.map((c) => anon.get(c)?.label)).toEqual(["Author 1", "Author 2", "Author 1"]);
    expect(JSON.stringify([...anon.values()])).not.toContain("example.org");
  });

  it("sniffs patches only", () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    for (const s of [UNIFIED, NO_NEWLINE, LOG, MBOX]) expect(looksLikePatch(s)).toBe(true);
    expect(looksLikePatch("--- title ---\nsome markdown")).toBe(false);
    expect(diffAdapter.sniff?.(enc(RENAME))).toBe(true);
    expect(diffAdapter.sniff?.(enc("# Heading\n\ntext"))).toBe(false);
  });

  it("recognises GitHub pull request URLs and refuses credentials", () => {
    expect(pullDiffUrl("https://github.com/o/r/pull/12/files")).toBe("https://github.com/o/r/pull/12.diff");
    expect(pullDiffUrl("https://github.com/o/r/pull/12.patch")).toBe("https://github.com/o/r/pull/12.diff");
    expect(pullDiffUrl("https://github.com/o/r/issues/12")).toBeNull();
    expect(pullDiffUrl("https://example.org/o/r/pull/12")).toBeNull();
    expect(() => parsePullUrl("https://user:pw@github.com/o/r/pull/1")).toThrow(/credentials/);
    expect(() => parsePullUrl("https://github.com/o/r/pull/1.diff?token=abc")).toThrow(/token/);
  });
});

describe("diffAdapter", () => {
  it("lays out review panels with chained change blocks", async () => {
    const { blueprint, plugins } = await diffAdapter.load({ text: LOG, name: "log.patch" }, ctx);
    expect(blueprint.source).toMatchObject({ type: "diff", name: "log.patch", title: "Tune the engine" });
    expect(plugins?.[0]?.name).toBe("diff");
    const rows = blueprint.layers.filter((l) => l.kind === "custom" && l.task === LINE_TASK);
    expect(rows).toHaveLength(4);
    const [del, add] = rows;
    expect(add?.parent).toBe(del?.id);
    expect((del?.kind === "custom" ? readLineData(del.data) : null)?.author).toBe("Ada Lovelace");
    expect(blueprint.layers.find((l) => l.id === "c1-subject")).toMatchObject({ text: "Merge branch 'x'" });
    expect(blueprint.css).toContain(".sld-row");
    for (const l of blueprint.layers) {
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(blueprint.size.w);
      expect(l.box.y + l.box.h).toBeLessThanOrEqual(blueprint.size.h);
    }
  });

  it("anonymises authors everywhere in the blueprint", async () => {
    const { blueprint } = await createDiffAdapter({ anonymize: true }).load({ text: LOG }, ctx);
    const json = JSON.stringify(blueprint);
    expect(json).not.toContain("Ada");
    expect(json).not.toContain("example.org");
    expect(json).toContain("Author 1");
  });

  it("reports dropped content and rejects bad input", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `--- a/f${i}\n+++ b/f${i}\n@@ -1 +1 @@\n-a\n+b\n`).join("");
    const { blueprint } = await diffAdapter.load({ text: many }, { ...ctx, maxLayers: 60 });
    expect(blueprint.truncated?.dropped).toBeGreaterThan(0);
    await expect(diffAdapter.load({ text: "nothing here" }, ctx)).rejects.toThrow(DiffError);
    await expect(diffAdapter.load({ url: "https://github.com/o/r/pull/3" }, ctx)).rejects.toThrow(/CLI only/);
    await expect(createDiffAdapter({ maxBytes: 8 }).load({ text: UNIFIED }, ctx)).rejects.toThrow(/too large/);
  });

  it("validates line data", () => {
    const ok: DiffLineData = { v: 1, kind: "add", text: "x", numW: 30, signW: 18, cellW: 7.5 };
    expect(readLineData(ok)).toEqual(ok);
    expect(readLineData({ ...ok, kind: "weird" })).toBeNull();
    expect(readLineData({ ...ok, numW: Number.NaN })).toBeNull();
    expect(readLineData({ ...ok, oldNo: -1 })).toBeNull();
  });
});
