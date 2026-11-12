import { describe, expect, it } from "vitest";
import { EXPORT_MAX_SECONDS, exportSettingsOf } from "../src/export/browser";
import { buildCliCommand, type CliCommandOptions, cliHint, shellArg } from "../src/export/cli";
import type { StudioServices } from "../src/services";
import { DEFAULT_SETTINGS } from "../src/settings";
import { type LocalInput, resolveSource } from "../src/source";

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
    ["https://example.com/docs/中.md", "https://example.com/docs/中.md"],
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
    // cmd.exe reads `%DATE%` here, also inside double quotes, so percent-escapes are never written.
    "%DATE%20.md",
    "https://example.com/docs/%E4%B8%AD.md",
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
    // Escaped letters of a link are written as letters (the CLI escapes them again), other escapes are
    // not: `%DATABASE_URL%` would send a secret to the link's server.
    expect(command("https://example.com/%E4%B8%AD.md", false, "中.md").text).toBe(
      "npx swarmloom render https://example.com/中.md -o 中.mp4 --seed 1",
    );
    expect(command("https://evil.example/x%DATABASE_URL%2F/deck.md", false, "deck.md")).toEqual({
      text: "npx swarmloom render deck.md -o deck.mp4 --seed 1",
      saveAs: "deck.md",
    });
  });

  // Windows opens these as devices even with an extension: the source could not be saved under its
  // name and the video would be thrown away.
  it.each([
    ["NUL.md", "NUL_.md", "NUL_.mp4"],
    ["con.final.md", "con_.final.md", "con_.final.mp4"],
    ["COM1.md", "COM1_.md", "COM1_.mp4"],
    ["NUL .md", "NUL_.md", "NUL_.mp4"],
    ["console.md", "console.md", "console.mp4"],
    ["COM10.md", "COM10.md", "COM10.mp4"],
  ])("reads %j as %s and writes %s", (name, input, output) => {
    expect(command(name, true)).toEqual({ text: `npx swarmloom render ${input} -o ${output} --seed 1`, saveAs: input });
  });

  it("writes the export dialog's choices, and the in-page export uses the same settings", () => {
    const settings = { ...DEFAULT_SETTINGS, follow: "scroll" as const, remoteAssets: false };
    const choices = { sound: false, scheme: "dark" as const, locale: "zh-CN" };
    const base = { target: "a.md", targetIsFile: false, name: "a.md", settings, format: "mp4" as const };
    // The dialog's length limit is not the CLI default, so long builds stop at the same frame.
    const dialog = { width: 1080, height: 1920, fps: 60, maxDuration: EXPORT_MAX_SECONDS, ...choices };
    expect(buildCliCommand({ ...base, ...dialog }).text).toBe(
      "npx swarmloom render a.md -o a.mp4 --width 1080 --height 1920 --fps 60 --max-duration 600 --seed 1 --theme dark --locale zh-CN --no-sound --no-remote",
    );
    expect(exportSettingsOf(settings, choices)).toMatchObject({
      theme: "dark",
      follow: "tour",
      sound: false,
      locale: "zh-CN",
    });
    // English, the light scheme and 30 fps are the CLI defaults.
    const plain = { ...base, settings: DEFAULT_SETTINGS, width: 1280, height: 720, fps: 30, scheme: "light" as const };
    expect(buildCliCommand({ ...plain, locale: "en-GB" }).text).toBe("npx swarmloom render a.md -o a.mp4 --seed 1");
  });

  it("sends the user to an opened file's folder and has pasted text saved first", async () => {
    const hintOf = async (local: LocalInput) => {
      const ref = { kind: "file" as const, name: local.name };
      const opened = await resolveSource(ref, { services: {} as StudioServices, local });
      const cli = command(opened.cliTarget, opened.cliTargetKind !== "url", opened.name);
      return cliHint(opened.cliTargetKind, opened.cliTarget, cli.saveAs);
    };
    const bytes = new TextEncoder().encode("# Notes");
    // The browser knows a picked file's name, not its folder, and the command reads it from there.
    expect(await hintOf({ name: "welcome.en.md", bytes })).toEqual({
      key: "export.cli.folder",
      vars: { name: "welcome.en.md" },
    });
    expect(await hintOf({ name: "R&D notes.md", bytes })).toEqual({
      key: "export.cli.rename",
      vars: { name: "R-D-notes.md", file: "R&D notes.md" },
    });
    expect(await hintOf({ name: "pasted.md", text: "# Notes" })).toEqual({
      key: "export.cli.save",
      vars: { name: "pasted.md" },
    });
  });
});
