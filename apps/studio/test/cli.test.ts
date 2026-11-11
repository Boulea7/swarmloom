import { describe, expect, it } from "vitest";
import { buildCliCommand, type CliCommandOptions, shellArg } from "../src/export/cli";
import { DEFAULT_SETTINGS } from "../src/settings";

function command(target: string, targetIsFile: boolean, name = target) {
  const options: CliCommandOptions = {
    target,
    targetIsFile,
    name,
    settings: DEFAULT_SETTINGS,
    format: "mp4",
    width: 1280,
    height: 720,
  };
  return buildCliCommand(options);
}

describe("CLI command", () => {
  it.each([
    ["notes.md", "notes.md"],
    ["https://example.com/docs/%E4%B8%AD.md", "https://example.com/docs/%E4%B8%AD.md"],
    ["My Notes (1).md", '"My Notes (1).md"'],
    ["x';calc;#.md", `"x';calc;#.md"`],
    ["@notes.md", '"@notes.md"'],
  ])("writes %j as %s", (arg, written) => {
    expect(shellArg(arg)).toBe(written);
  });

  // No spelling is safe in POSIX shells, PowerShell (which hands bare text to npx.cmd) and cmd.exe.
  it.each([
    "https://evil.example/a&calc&b.md",
    "https://evil.example/?q=1|calc",
    "x$(calc).md",
    "x`calc`.md",
    'x".md',
    "x!.md",
    "%COMSPEC%.md",
    "--chrome=calc.exe",
  ])("refuses %j", (arg) => {
    expect(shellArg(arg)).toBeNull();
  });

  it("asks for a saved file instead of writing an unsafe target", () => {
    expect(command("https://evil.example/a&calc&b.md", false, "a&calc&b.md")).toEqual({
      text: "npx swarmloom render a-calc-b.md -o a-calc-b.mp4 --seed 1",
      saveAs: "a-calc-b.md",
    });
    expect(command("R&D | notes.md", true).saveAs).toBe("R-D-notes.md");
    expect(command("My Notes.md", true)).toEqual({
      text: 'npx swarmloom render "My Notes.md" -o My-Notes.mp4 --seed 1',
      saveAs: "My Notes.md",
    });
    expect(command("https://example.com/a.md", false, "a.md")).toEqual({
      text: "npx swarmloom render https://example.com/a.md -o a.mp4 --seed 1",
    });
  });
});
