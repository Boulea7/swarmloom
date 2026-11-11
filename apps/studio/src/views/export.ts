import type { BrowserExportResult, ExportProgress } from "@swarmloom/export/browser";
import type { AppContext } from "../context";
import {
  canEncodeInBrowser,
  clockOf,
  EXPORT_FPS,
  EXPORT_MAX_SECONDS,
  type ExportFps,
  exportFileName,
  exportSettingsOf,
  renderInputOf,
} from "../export/browser";
import { buildCliCommand, FRAME_PRESETS, VIDEO_FORMATS, type VideoFormat } from "../export/cli";
import type { BrowserExporter } from "../services";
import type { OpenedSource } from "../source";
import { button, nextId, segmented, select, toggle } from "../ui/controls";
import { createPanel, type Panel } from "../ui/dialog";
import { formatSize, h } from "../ui/dom";
import { icon } from "../ui/icons";

export interface ExportDeps {
  ctx: AppContext;
  opened: () => OpenedSource | null;
}

export interface Exporter {
  /** The dialog. {@link relabel} replaces it, so read it again rather than keeping it. */
  readonly panel: Panel;
  open(): void;
  /** The interface language changed: rebuilds the dialog in place, keeping choices, progress and results. */
  relabel(): void;
  /** Cancels a running export and frees the result. */
  destroy(): void;
}

/** A finished export, ready to download. */
interface ExportFile {
  url: string;
  name: string;
  size: number;
  durationMs: number;
  /** Sound was asked for but the browser could not encode it. */
  silent: boolean;
  /** Images or fonts the frame could not read (another site without CORS): blank in the video. */
  blanks: number;
  /** The build ran longer than the export allows; the video stops there. */
  partial: boolean;
}

/** The dialog's DOM for one language. */
interface ExportUi {
  panel: Panel;
  options: HTMLFieldSetElement;
  soundSwitch: HTMLInputElement | null;
  start: HTMLButtonElement | null;
  cancel: HTMLButtonElement | null;
  download: HTMLAnchorElement | null;
  bar: HTMLElement | null;
  fill: HTMLElement | null;
  status: HTMLElement;
  renderCommand(): void;
}

/** Shortest gap between two status line updates, so screen readers are not flooded. */
const STATUS_INTERVAL = 1000;

/** Settles as `work` does, or rejects with the signal's reason as soon as it aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Export dialog: a frame-exact export in this page (WebCodecs and Mediabunny, loaded when the
 * dialog first opens) and the `npx swarmloom render` command that makes the same file. Browsers
 * without WebCodecs get the command only.
 */
export function createExporter(deps: ExportDeps): Exporter {
  const { ctx } = deps;
  let format: VideoFormat = "mp4";
  let preset = FRAME_PRESETS[0] ?? { id: "720p", width: 1280, height: 720 };
  let fps: ExportFps = 30;
  /** Sound switch; null follows the Sound setting. */
  let sound: boolean | null = null;
  let running: AbortController | null = null;
  let progress: ExportProgress | null = null;
  let file: ExportFile | null = null;
  /** Status line in the current language: a phase, a result or an error. */
  let note: (() => string) | null = null;
  let statusAt = 0;
  let exporterModule: Promise<BrowserExporter> | null = null;

  const supported = () => Boolean(ctx.services.loadExporter) && canEncodeInBrowser();
  const soundOn = () => sound ?? ctx.settings.sound;

  /** Loads the exporter once; a failed load (offline) is tried again next time. */
  const loadExporter = (): Promise<BrowserExporter> => {
    const load = ctx.services.loadExporter;
    if (!load) return Promise.reject(new Error("The exporter is not available"));
    exporterModule ??= load().catch((error: unknown) => {
      exporterModule = null;
      throw error;
    });
    return exporterModule;
  };

  const progressText = (p: ExportProgress | null): string => {
    const { i18n } = ctx;
    if (!p) return i18n.t("export.web.loading");
    switch (p.phase) {
      case "starting":
        return i18n.t("export.web.starting");
      case "sound":
        return i18n.t("export.web.sound");
      case "finishing":
        return i18n.t("export.web.finishing");
      default: {
        const vars = { frame: String(p.frames), total: String(p.totalFrames) };
        return p.etaMs === null
          ? i18n.t("export.web.frames", vars)
          : i18n.t("export.web.framesEta", { ...vars, time: clockOf(p.etaMs) });
      }
    }
  };

  const fileText = (f: ExportFile): string => {
    const { i18n } = ctx;
    // Whole seconds, rounded: clockOf rounds up, which suits a countdown but not a length.
    const time = clockOf(Math.round(f.durationMs / 1000) * 1000);
    const parts = [i18n.t("export.web.ready", { time, size: formatSize(f.size, i18n.locale) })];
    if (f.blanks > 0) parts.push(i18n.t("export.web.blanks", { count: f.blanks }));
    if (f.silent) parts.push(i18n.t("export.web.silent"));
    if (f.partial) parts.push(i18n.t("export.web.partial"));
    return parts.join(" ");
  };

  const build = (): ExportUi => {
    const { i18n } = ctx;
    const panel = createPanel({
      title: i18n.t("export.title"),
      closeLabel: i18n.t("export.close"),
      class: "panel-dialog panel-export",
    });

    // Shared choices: the in-page export and the command line make the same file from them.
    const sizeControl = select({
      label: i18n.t("export.size"),
      choices: FRAME_PRESETS.map((p) => ({ value: p.id, label: `${p.width} × ${p.height}` })),
      value: preset.id,
      onChange: (id) => {
        preset = FRAME_PRESETS.find((p) => p.id === id) ?? preset;
        renderCommand();
      },
    });
    const fpsControl = segmented<`${ExportFps}`>({
      legend: i18n.t("export.fps"),
      name: nextId("export-fps"),
      choices: EXPORT_FPS.map((value) => ({ value: `${value}`, label: i18n.t("export.fpsValue", { fps: value }) })),
      value: `${fps}`,
      onChange: (value) => {
        fps = Number(value) as ExportFps;
        renderCommand();
      },
    });
    const soundControl = toggle({
      label: i18n.t("export.sound"),
      checked: soundOn(),
      onChange: (on) => {
        sound = on;
        renderCommand();
      },
    });
    const options = h(
      "fieldset",
      { class: "export-choices" },
      h("div", { class: "export-options" }, sizeControl, fpsControl),
      soundControl,
    );

    // In this browser
    const status = h("p", { class: "export-status", attrs: { role: "status" } });
    let start: HTMLButtonElement | null = null;
    let cancel: HTMLButtonElement | null = null;
    let download: HTMLAnchorElement | null = null;
    let bar: HTMLElement | null = null;
    let fill: HTMLElement | null = null;
    const webSection = h(
      "section",
      { class: "export-section" },
      h("h3", { class: "export-title" }, icon("export", 18), h("span", { text: i18n.t("export.web.title") })),
      h("p", { class: "export-body", text: i18n.t(supported() ? "export.web.body" : "export.web.unsupported") }),
    );
    if (supported()) {
      start = button({
        label: i18n.t("export.web.start"),
        icon: "export",
        variant: "primary",
        onClick: () => void runExport(),
      });
      cancel = button({ label: i18n.t("export.web.cancel"), icon: "stop", onClick: () => running?.abort() });
      download = h(
        "a",
        { class: "btn btn-secondary" },
        icon("download", 18),
        h("span", { class: "btn-label", text: i18n.t("export.web.download") }),
      );
      fill = h("div", { class: "export-progress-fill" });
      bar = h(
        "div",
        {
          class: "export-progress",
          attrs: {
            role: "progressbar",
            "aria-label": i18n.t("export.web.progress"),
            "aria-valuemin": 0,
            "aria-valuemax": 100,
          },
        },
        fill,
      );
      webSection.append(bar, h("div", { class: "export-actions" }, start, cancel, download));
    }
    webSection.append(status);

    // Command line
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
        fps,
        maxDuration: EXPORT_MAX_SECONDS,
        sound: soundOn(),
        scheme: ctx.scheme,
        locale: ctx.i18n.locale,
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
        window.getSelection()?.selectAllChildren(command);
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
    const cliSection = h(
      "section",
      { class: "export-section" },
      h("h3", { class: "export-title" }, icon("terminal", 18), h("span", { text: i18n.t("export.cli.title") })),
      h("p", { class: "export-body", text: i18n.t("export.cli.body") }),
      formatControl,
      h("div", { class: "cli-block" }, h("pre", { class: "cli-pre", attrs: { tabindex: 0 } }, command), copyButton),
      saveHint,
    );

    panel.body.append(h("div", { class: "export-section" }, options), webSection, cliSection);
    const soundSwitch = soundControl.querySelector<HTMLInputElement>("input.switch");
    return { panel, options, soundSwitch, start, cancel, download, bar, fill, status, renderCommand };
  };

  let ui = build();

  const statusText = (): string => (running ? progressText(progress) : (note?.() ?? (file ? fileText(file) : "")));

  /** Puts the state into the DOM; `force` also refreshes a status line updated less than a second ago. */
  const render = (force = true) => {
    const busy = running !== null;
    ui.options.disabled = busy;
    if (ui.start) ui.start.hidden = busy;
    if (ui.cancel) ui.cancel.hidden = !busy;
    if (ui.download) {
      ui.download.hidden = busy || !file;
      if (file) {
        ui.download.href = file.url;
        ui.download.download = file.name;
      } else {
        ui.download.removeAttribute("href");
      }
    }
    if (ui.bar && ui.fill) {
      ui.bar.hidden = !busy;
      const p = progress;
      const value = !p ? 0 : p.phase === "frames" ? Math.floor((100 * p.frames) / Math.max(1, p.totalFrames)) : 100;
      const shown = p?.phase === "starting" ? 0 : value;
      ui.bar.setAttribute("aria-valuenow", String(shown));
      ui.fill.style.width = `${shown}%`;
    }
    const now = performance.now();
    if (force || now - statusAt >= STATUS_INTERVAL) {
      statusAt = now;
      ui.status.textContent = statusText();
    }
  };

  /** True when moving focus will not pull it out of somewhere else on the page. */
  const focusIsOurs = () => {
    const active = document.activeElement;
    return ui.panel.isOpen && (!active || active === document.body || ui.panel.root.contains(active));
  };

  const clearFile = () => {
    if (file) URL.revokeObjectURL(file.url);
    file = null;
  };

  const runExport = async () => {
    const opened = deps.opened();
    if (!opened || running) return;
    clearFile();
    note = null;
    progress = null;
    const controller = new AbortController();
    running = controller;
    const moveFocus = focusIsOurs();
    render();
    if (moveFocus) ui.cancel?.focus();
    const { signal } = controller;
    let result: BrowserExportResult | null = null;
    try {
      // Cancel answers at once, also while the exporter or the hidden frame still loads; the
      // exporter notices the signal at its next step and cleans up after itself.
      const exporter = await untilAborted(loadExporter(), signal);
      result = await untilAborted(
        exporter.exportVideo({
          input: renderInputOf(opened, exporter.bytesToBase64),
          width: preset.width,
          height: preset.height,
          fps,
          maxDurationMs: EXPORT_MAX_SECONDS * 1000,
          settings: exportSettingsOf(ctx.settings, { sound: soundOn(), scheme: ctx.scheme, locale: ctx.i18n.locale }),
          network: ctx.settings.remoteAssets ? "https" : "none",
          signal,
          onProgress: (p) => {
            // A cancelled run may still report while it winds down; the dialog has moved on.
            if (running !== controller) return;
            const phaseChanged = p.phase !== progress?.phase;
            progress = p;
            render(phaseChanged);
          },
        }),
        signal,
      );
    } catch (error) {
      if (signal.aborted) note = () => ctx.i18n.t("export.web.cancelled");
      else if ((error as { name?: string }).name === "UnsupportedExportError")
        note = () => ctx.i18n.t("export.web.noCodec");
      else {
        console.warn("[studio] export failed", error);
        const message = error instanceof Error ? error.message : String(error);
        note = () => ctx.i18n.t("export.web.failed", { message });
      }
    }
    // destroy() ran meanwhile: the result has nowhere to go.
    if (running !== controller) return;
    running = null;
    progress = null;
    if (result) {
      if (result.warnings.length > 0) console.warn("[studio] export warnings", result.warnings);
      file = {
        url: URL.createObjectURL(result.blob),
        name: exportFileName(opened.name, result.extension),
        size: result.blob.size,
        durationMs: result.durationMs,
        silent: result.soundUnsupported,
        // Every warning but the silent-video one (reported once, as `silent`) is a resource left out.
        blanks: Math.max(0, result.warnings.length - (result.soundUnsupported ? 1 : 0)),
        partial: !result.finished,
      };
    }
    const refocus = focusIsOurs();
    render();
    if (refocus) (file ? ui.download : ui.start)?.focus();
  };

  render();

  return {
    get panel() {
      return ui.panel;
    },
    open() {
      if (sound === null && ui.soundSwitch) ui.soundSwitch.checked = ctx.settings.sound;
      ui.renderCommand();
      render();
      ui.panel.open(true);
      // Fetch the exporter now, so it is ready by the time Export is pressed.
      if (supported()) loadExporter().catch((error: unknown) => console.warn("[studio] exporter unavailable", error));
    },
    relabel() {
      const old = ui;
      const wasOpen = old.panel.isOpen;
      ui = build();
      old.panel.root.replaceWith(ui.panel.root);
      old.panel.destroy();
      render();
      if (wasOpen) {
        ui.renderCommand();
        ui.panel.open(true);
      }
    },
    destroy() {
      running?.abort();
      running = null;
      clearFile();
      ui.panel.destroy();
    },
  };
}
