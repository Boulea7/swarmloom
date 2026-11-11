import type { PlayerState } from "@swarmloom/core";
import type { AppContext, View } from "../context";
import { describeError } from "../errors";
import { formatOfName } from "../formats-meta";
import type { SourceRef } from "../route";
import { Session, type SessionPhase } from "../session";
import type { StudioSettings } from "../settings";
import { button } from "../ui/controls";
import { formatSize, h, isTyping } from "../ui/dom";
import { icon } from "../ui/icons";
import { appBar, settingsButton, themeButton } from "./chrome";
import { createExporter } from "./export";
import { formatLabel } from "./home";
import { buildShareLink } from "./share-link";

/** Name to show before the source has been resolved. */
function provisionalName(ctx: AppContext, ref: SourceRef): string {
  switch (ref.kind) {
    case "example":
      return ctx.services.manifest.entries.find((e) => e.id === ref.id)?.title ?? ref.id;
    case "url":
      try {
        const u = new URL(ref.url);
        return decodeURIComponent(u.pathname.split("/").pop() || "") || u.hostname;
      } catch {
        return ref.url;
      }
    case "file":
      return ctx.local?.name ?? ref.name;
    default:
      return ctx.i18n.t("app.name");
  }
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const SCRUB_STEPS = 1000;

/**
 * Player: the source title bar, a full-bleed inline stage (core player with its own toolbar), a
 * Studio scrubber, share and export. Loading, ready and error states render over the stage.
 */
export function createPlayerView(ctx: AppContext, ref: SourceRef): View {
  const { i18n } = ctx;
  let phase: SessionPhase = "opening";
  let scheme = ctx.scheme;
  let built = 0;
  let total = 0;
  let recTimer = 0;
  let seekFrame = 0;
  /** Autoplay links start the first time the player is ready, never again after a rebuild. */
  let autoplayPending = ctx.route.autoplay;

  // Title block
  const name = provisionalName(ctx, ref);
  const title = h("h1", { class: "player-title", text: name });
  const meta = h("span", { class: "player-meta" });
  const guess = formatOfName(name);
  if (guess) meta.textContent = formatLabel(ctx, guess.id);

  // Actions
  const shareButton = button({
    label: i18n.t("player.share"),
    icon: "share",
    variant: "quiet",
    class: "hide-narrow-label",
    onClick: () => void share(),
  });
  const exportButton = button({
    label: i18n.t("player.export"),
    icon: "export",
    variant: "secondary",
    shortcut: "E",
    class: "hide-narrow-label",
    onClick: () => exporter.open(),
  });
  const theme = themeButton(ctx);
  shareButton.disabled = true;
  exportButton.disabled = true;
  const back = button({
    label: i18n.t("nav.back"),
    icon: "back",
    iconOnly: true,
    variant: "quiet",
    onClick: () => ctx.navigate({ source: null }),
  });
  const bar = appBar(ctx, {
    lead: [back, h("div", { class: "player-heading" }, title, meta)],
    actions: [shareButton, exportButton, theme, settingsButton(ctx)],
  });
  bar.classList.add("appbar-player");

  // Stage and overlay
  const host = h("div", { class: "stage-host", data: { stageHost: "" } });
  const overlay = h("div", { class: "stage-overlay", attrs: { "aria-live": "polite" } });
  const frame = h("div", { class: "stage-frame", data: { phase } }, host, overlay);

  // Notice (truncated builds)
  const notice = h("div", { class: "player-notice", attrs: { hidden: true, role: "note" } });

  // Scrubber: a seek slider when the engine can seek, a progress bar otherwise.
  const fill = h("span", { class: "progress-fill" });
  const track = h(
    "div",
    {
      class: "progress",
      attrs: {
        role: "progressbar",
        "aria-label": i18n.t("player.progress"),
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": 0,
      },
    },
    fill,
  );
  const seeker = h("input", {
    class: "scrub-range",
    attrs: {
      type: "range",
      min: 0,
      max: SCRUB_STEPS,
      step: 1,
      value: 0,
      "aria-label": i18n.t("player.scrub"),
      hidden: true,
    },
    on: { input: () => scheduleSeek() },
  });
  // A seek re-simulates the build synchronously, so dragging seeks once per frame to the latest
  // value instead of once per input event.
  const scheduleSeek = () => {
    if (seekFrame !== 0) return;
    seekFrame = window.requestAnimationFrame(() => {
      seekFrame = 0;
      session.seek(Number(seeker.value) / SCRUB_STEPS);
    });
  };
  const count = h("span", { class: "scrub-count", attrs: { "aria-hidden": "true" } });
  const recLabel = h("span", { class: "rec-time" });
  const recPill = h(
    "div",
    { class: "rec-pill", attrs: { hidden: true, role: "status" } },
    h("span", { class: "rec-dot", attrs: { "aria-hidden": "true" } }),
    recLabel,
    button({
      label: i18n.t("export.record.stop"),
      icon: "stop",
      variant: "ghost",
      onClick: () => exporter.stopRecording(),
    }),
  );
  const foot = h("div", { class: "player-foot" }, h("div", { class: "scrubber" }, track, seeker), count, recPill);

  const root = h("main", { class: "view view-player", attrs: { id: "main", tabindex: -1 } }, bar, notice, frame, foot);

  const exporter = createExporter({
    ctx,
    opened: () => session.opened,
    target: () => host,
    restart: () => session.rebuild(true),
    onRecording: (rec) => {
      window.clearInterval(recTimer);
      recPill.hidden = !rec;
      if (!rec) return;
      const tick = () => {
        recLabel.textContent = i18n.t("export.record.recording", { time: clock(performance.now() - rec.startedAt) });
      };
      tick();
      recTimer = window.setInterval(tick, 1000);
    },
  });
  root.append(exporter.panel.root);

  const renderProgress = () => {
    const fraction = total > 0 ? Math.min(1, built / total) : 0;
    fill.style.transform = `scaleX(${fraction})`;
    track.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    if (!seeker.matches(":active")) seeker.value = String(Math.round(fraction * SCRUB_STEPS));
    count.textContent = total > 0 ? `${built} / ${total}` : "";
  };

  const renderOverlay = (error?: unknown) => {
    frame.dataset.phase = phase;
    overlay.replaceChildren();
    if (phase === "opening" || phase === "loading") {
      const caption =
        ref.kind === "handoff" && phase === "opening"
          ? i18n.t("player.receiving")
          : phase === "opening"
            ? i18n.t("player.loading", { name: title.textContent ?? "" })
            : i18n.t("player.preparing");
      overlay.append(
        h(
          "div",
          { class: "stage-loading" },
          h(
            "div",
            { class: "skeleton", attrs: { "aria-hidden": "true" } },
            ...["w-40", "w-90", "w-75", "w-85", "w-60"].map((w) => h("span", { class: `skeleton-line ${w}` })),
          ),
          h("p", { class: "stage-caption", text: caption }),
        ),
      );
      return;
    }
    if (phase === "ready") {
      const opened = session.opened;
      const sub = [meta.textContent, opened?.example ? formatSize(opened.example.size, i18n.locale) : ""]
        .filter(Boolean)
        .join(" · ");
      overlay.append(
        h(
          "div",
          { class: "stage-ready" },
          h(
            "button",
            {
              class: "play-big",
              attrs: { type: "button", "aria-label": i18n.t("player.start") },
              on: { click: () => session.start() },
            },
            icon("play", 30),
          ),
          h("p", { class: "stage-ready-title", text: title.textContent ?? "" }),
          sub ? h("p", { class: "stage-ready-sub", text: sub }) : null,
          h("p", { class: "stage-ready-hint", attrs: { "aria-hidden": "true" }, text: i18n.t("player.start") }),
        ),
      );
      return;
    }
    if (phase === "error") {
      const message = describeError(error, i18n, { formats: ctx.formatList(), label: title.textContent ?? "" });
      overlay.append(
        h(
          "div",
          { class: "stage-error", attrs: { role: "alert" } },
          h("span", { class: "stage-error-icon" }, icon("alert", 22)),
          h("h2", { class: "stage-error-title", text: i18n.t("error.title") }),
          h("p", { class: "stage-error-body", text: message }),
          h(
            "div",
            { class: "stage-error-actions" },
            button({
              label: i18n.t("player.retry"),
              icon: "refresh",
              variant: "primary",
              onClick: () => void session.reload(true),
            }),
            button({
              label: i18n.t("player.home"),
              variant: "secondary",
              // `?import=1` (extension without access to the origin): land on the file picker.
              onClick: () => ctx.navigate({ source: null, import: ctx.route.import }),
            }),
          ),
        ),
      );
    }
  };

  const showOpened = () => {
    const opened = session.opened;
    if (!opened) return;
    title.textContent = opened.title;
    const format = session.loaded?.blueprint.source.type ?? opened.format;
    if (format) meta.textContent = formatLabel(ctx, format);
    document.title = `${opened.title} · ${i18n.t("app.name")}`;
    shareButton.disabled = false;
  };

  const showTruncated = () => {
    const truncated = session.loaded?.blueprint.truncated;
    if (!truncated || truncated.dropped <= 0) {
      notice.hidden = true;
      return;
    }
    notice.replaceChildren(
      icon("alert", 16),
      h("span", { text: i18n.t("player.truncated", { count: truncated.dropped }) }),
      button({
        label: i18n.t("player.dismiss"),
        icon: "close",
        iconOnly: true,
        variant: "ghost",
        onClick: () => (notice.hidden = true),
      }),
    );
    notice.hidden = false;
  };

  const session = new Session({
    services: ctx.services,
    host,
    ref,
    local: ctx.local,
    settings: ctx.settings,
    locale: i18n.locale,
    scheme,
    onPhase: (next, error) => {
      phase = next;
      root.dataset.phase = next;
      if (next === "ready" || next === "error") showOpened();
      if (next === "ready") {
        showTruncated();
        exportButton.disabled = false;
        seeker.hidden = !session.canSeek;
        track.hidden = session.canSeek;
        if (autoplayPending) {
          autoplayPending = false;
          session.start();
          return;
        }
      }
      renderOverlay(error);
    },
    onProgress: (b, t) => {
      built = b;
      total = t;
      renderProgress();
    },
    onState: (state: PlayerState) => {
      root.dataset.state = state;
    },
    onClose: () => ctx.navigate({ source: null }),
  });

  renderOverlay();
  renderProgress();
  void session.open();

  async function share(): Promise<void> {
    const opened = session.opened;
    if (!opened) return;
    const link = await buildShareLink(opened, ctx.settings, ctx.appUrl);
    if (!link.ok) {
      ctx.toast.show(
        i18n.t(
          link.reason === "tooLarge" ? "share.tooLarge" : link.reason === "binary" ? "share.binary" : "share.failed",
        ),
        { icon: "alert" },
      );
      return;
    }
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: i18n.t("share.title", { name: opened.title }), url: link.url });
        return;
      } catch (error) {
        if ((error as DOMException).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(link.url);
      ctx.toast.show(i18n.t("share.copied"), { icon: "check" });
    } catch {
      ctx.toast.show(i18n.t("share.failed"), { icon: "alert" });
    }
  }

  const applyScheme = (next: "light" | "dark") => {
    if (next === scheme) return;
    scheme = next;
    session.setScheme(next);
    if (phase === "opening" || phase === "loading" || phase === "error") return;
    void session.reload(phase === "playing" || phase === "done");
  };

  return {
    root,
    onKey(event) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return false;
      if ((event.key === "e" || event.key === "E") && !exportButton.disabled) {
        exporter.open();
        return true;
      }
      if (event.key === "Escape" && !exporter.panel.isOpen) {
        ctx.navigate({ source: null });
        return true;
      }
      return false;
    },
    settingsChanged(prev: StudioSettings, next: StudioSettings) {
      const impact = session.apply(next);
      if (impact === "reload") {
        if (prev.remoteAssets !== next.remoteAssets) {
          scheme = ctx.scheme;
          session.setScheme(scheme);
          if (phase !== "opening" && phase !== "loading") void session.reload(phase === "playing" || phase === "done");
        } else {
          applyScheme(ctx.scheme);
        }
        return;
      }
      if (impact !== "rebuild") return;
      if (phase === "ready") {
        session.rebuild(false);
        return;
      }
      if (phase === "playing" || phase === "done") {
        ctx.toast.show(i18n.t("player.restartHint"), {
          icon: "refresh",
          action: { label: i18n.t("player.restart"), run: () => session.rebuild(true) },
        });
      }
    },
    schemeChanged: applyScheme,
    destroy() {
      window.clearInterval(recTimer);
      window.cancelAnimationFrame(seekFrame);
      exporter.destroy();
      session.destroy();
    },
  };
}
