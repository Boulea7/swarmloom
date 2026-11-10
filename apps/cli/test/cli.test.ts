import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { run } from "../src/run";

function capture(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("swarmloom cli", () => {
  it.each([
    [["--version"], 0, pkg.version, ""],
    [["--help"], 0, "Usage: swarmloom <command>", ""],
    [["render", "--help"], 0, "render <file|url>", ""],
    [["render", "page.html"], 1, "", "not implemented yet"],
    [["bogus"], 2, "", 'Unknown command "bogus"'],
  ])("%j exits %i", (argv, code, out, err) => {
    const result = capture(argv);
    expect(result.code).toBe(code);
    expect(result.out).toContain(out);
    expect(result.err).toContain(err);
  });
});
