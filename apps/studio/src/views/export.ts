import type { Recording } from "@swarmloom/export";
import type { AppContext } from "../context";
import { buildCliCommand, FRAME_PRESETS, VIDEO_FORMATS, type VideoFormat } from "../export/cli";
import type { OpenedSource } from "../source";
import { button, nextId, segmented, select } from "../ui/controls";
import { createPanel, type Panel } from "../ui/dialog";
import { formatSize, h } from "../ui/dom";
import { icon } from "../ui/icons";

export interface ExportDeps {
  ctx: AppContext;
  opened: () => OpenedSource | null;
  /** Element to record (the stage host). */
  target: () => HTMLElement;
  /** Restarts the build from the beginning, so the recording covers all of it. */
  restart: () => void;
  /** Called while recording starts and stops, so the player can show a recording indicator. */
  onRecording: (recording: { stop(): void; startedAt: number } | null) => void;
}

export interface Exporter {
  readonly panel: Panel;
  open(): void;
  /** Stops a running recording (keeps what was recorded). */
  stopRecording(): void;
  destroy(): void;
}

function downloadName(name: string, mime: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "swarmloom";
  return `${stem}.${mime.includes("mp4") ? "mp4" : "webm"}`;
}

/**
 * Export dialog: quick in-browser recording where the browser can crop a tab capture to the stage
 * (labelled "quick", it runs in real time), and the frame-exact `npx swarmloom render` command that
 * reproduces the same performance from the same seed.
 */
export function createExporter(deps: ExportDeps): Exporter {
  const { ctx } = deps;
  const { i18n } = ctx;
  let format: VideoFormat = "mp4";
  let preset = FRAME_PRESETS[0] ?? { id: "720p", width: 1280, height: 720 };
  let recording: Recording | null = null;
  let resultUrl: string | null = null;

  const panel = createPanel({
    title: i18n.t("export.title"),
    closeLabel: i18n.t("export.close"),
    class: "panel-dialog panel-export",
  });

  // Command line section
  const command = h("code", { class: "cli-code" });
  const copyLabel = h("span", { class: "btn-label", text: i18n.t("export.cli.copy") });
  const copyButton = h(
    "button",
    { class: "btn btn-secondary cli-copy", attrs: { type: "button" } },
    icon("copy", 18),
    copyLabel,
  );
  const saveHint = h("p", { class: "field-hint cli-save", attrs: { hidden: true } });
  const renderCommand = () => {
    const opened = deps.opened();
    if (!opened) return;
    const cli = buildCliCommand({
      target: opened.cliTarget,
      targetIsFile: opened.cliNeedsFile,
      name: opened.name,
      settings: ctx.settings,
      format,
      width: preset.width,
      height: preset.height,
    });
    command.textContent = cli.text;
    saveHint.hidden = cli.saveAs === undefined;
    saveHint.textContent = cli.saveAs
      ? i18n.t(opened.cliNeedsFile ? "export.cli.save" : "export.cli.download", { name: cli.saveAs })
      : "";
  };
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command.textContent ?? "");
      copyLabel.textContent = i18n.t("export.cli.copied");
      window.setTimeout(() => (copyLabel.textContent = i18n.t("export.cli.copy")), 1800);
    } catch {
      // Clipboard denied: select the text so the user can copy it by hand.
      const selection = window.getSelection();
      selection?.selectAllChildren(command);
      ctx.toast.show(i18n.t("share.failed"), { icon: "alert" });
    }
  });
  const formatControl = segmented<VideoFormat>({
    legend: i18n.t("export.cli.format"),
    name: nextId("export-format"),
    choices: VIDEO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() })),
    value: format,
    onChange: (value) => {
      format = value;
      renderCommand();
    },
  });
  const sizeControl = select({
    label: i18n.t("export.cli.size"),
    choices: FRAME_PRESETS.map((p) => ({ value: p.id, label: `${p.width} × ${p.height}` })),
    value: preset.id,
    onChange: (id) => {
      preset = FRAME_PRESETS.find((p) => p.id === id) ?? preset;
      renderCommand();
    },
  });
  const cliSection = h(
    "section",
    { class: "export-section" },
    h("h3", { class: "export-title" }, icon("terminal", 18), h("span", { text: i18n.t("export.cli.title") })),
    h("p", { class: "export-body", text: i18n.t("export.cli.body") }),
    h("div", { class: "export-options" }, formatControl, sizeControl),
    h("div", { class: "cli-block" }, h("pre", { class: "cli-pre", attrs: { tabindex: 0 } }, command), copyButton),
    saveHint,
  );

  // Quick recording section
  const canRecord = Boolean(ctx.services.recordElement && (ctx.services.canRecord?.() ?? false));
  const recordStatus = h("p", { class: "export-status", attrs: { role: "status" } });
  const download = h(
    "a",
    { class: "btn btn-secondary", attrs: { hidden: true, download: "" } },
    icon("download", 18),
    h("span", { class: "btn-label", text: i18n.t("export.record.download") }),
  );
  const startButton = button({
    label: i18n.t("export.record.start"),
    icon: "record",
    variant: "primary",
    onClick: () => void startRecording(),
  });
  const recordSection = h(
    "section",
    { class: "export-section" },
    h("h3", { class: "export-title" }, icon("record", 18), h("span", { text: i18n.t("export.record.title") })),
    h("p", {
      class: "export-body",
      text: canRecord ? i18n.t("export.record.body") : i18n.t("export.record.unsupported"),
    }),
    canRecord ? h("div", { class: "export-actions" }, startButton, download) : null,
    recordStatus,
  );
  panel.body.append(cliSection, recordSection);

  const clearResult = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    download.hidden = true;
  };

  const startRecording = async () => {
    const record = ctx.services.recordElement;
    const opened = deps.opened();
    if (!record || !opened || recording) return;
    clearResult();
    recordStatus.textContent = "";
    try {
      // Ask for the capture first: the permission prompt must not eat the first seconds of the build.
      const rec = await record(deps.target(), { audio: "tab" });
      recording = rec;
      panel.close();
      deps.restart();
      deps.onRecording({ stop: () => void rec.stop(), startedAt: performance.now() });
      const blob = await rec.result;
      recording = null;
      deps.onRecording(null);
      resultUrl = URL.createObjectURL(blob);
      download.setAttribute("href", resultUrl);
      download.setAttribute("download", downloadName(opened.name, rec.mimeType));
      download.hidden = false;
      recordStatus.textContent = i18n.t("export.record.ready", { size: formatSize(blob.size, i18n.locale) });
      panel.open(true);
    } catch (error) {
      recording = null;
      deps.onRecording(null);
      const code = (error as { code?: string }).code;
      // A cancelled share prompt is the user's choice, not an error worth a message.
      if (code === "denied") return;
      recordStatus.textContent = i18n.t("export.record.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (!panel.isOpen) panel.open(true);
    }
  };

  return {
    panel,
    open() {
      renderCommand();
      panel.open(true);
    },
    stopRecording() {
      void recording?.stop();
    },
    destroy() {
      void recording?.stop();
      recording = null;
      clearResult();
      panel.destroy();
    },
  };
}
