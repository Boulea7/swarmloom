import type { PlayerState } from "@swarmloom/core";
import type { AppContext, View } from "../context";
import { describeError } from "../errors";
import { formatOfName } from "../formats-meta";
import { localizeNote } from "../notes";
import type { SourceRef } from "../route";
import { Session, type SessionPhase } from "../session";
import type { StudioSettings } from "../settings";
import { nameOfRef } from "../source";
import { button } from "../ui/controls";
import { formatSize, h, isTyping } from "../ui/dom";
import { icon } from "../ui/icons";
import { appBar, settingsButton, themeButton } from "./chrome";
import { createExporter } from "./export";
import { formatLabel } from "./home";
import { createScrubber } from "./scrubber";
import { buildShareLink, shareRefusalKey } from "./share-link";

/** Name to show before the source has been resolved. */
function provisionalName(ctx: AppContext, ref: SourceRef): string {
  switch (ref.kind) {
    case "example":
      return ctx.services.manifest.entries.find((e) => e.id === ref.id)?.title ?? ref.id;
    case "url":
    case "file":
      return nameOfRef(ref, ctx.local);
    default:
      return ctx.i18n.t("app.name");
  }
}

/**
 * Player: the source title bar, a full-bleed inline stage (core player with its own toolbar), a
 * Studio scrubber, share and export. Loading, ready and error states render over the stage.
 */
export function createPlayerView(ctx: AppContext, ref: SourceRef): View {
  // Strings are read through ctx.i18n each time, so a language change (localeChanged) relabels
  // the view without touching the session that is playing.
  let phase: SessionPhase = "opening";
  let scheme = ctx.scheme;
  /** Error behind the "error" phase, kept to render the card again in another language. */
  let lastError: unknown;
  /** Autoplay links start the first time the player is ready, never again after a rebuild. */
  let autoplayPending = ctx.route.autoplay;
  /** The settings the source carries have been handed to Studio (once per view). */
  let sourceSettingsShown = false;

  // Title block
  const name = provisionalName(ctx, ref);
  const title = h("h1", { class: "player-title", text: name });
  const meta = h("span", { class: "player-meta" });
  const guess = formatOfName(name);
  if (guess) meta.textContent = formatLabel(ctx, guess.id);

  /** The app bar: back, title, share, export, theme and settings. Rebuilt on a language change. */
  const buildBar = (shareEnabled: boolean, exportEnabled: boolean) => {
    const { i18n } = ctx;
    const share = button({
      label: i18n.t("player.share"),
      icon: "share",
      variant: "quiet",
      class: "hide-narrow-label",
      onClick: () => void shareSource(),
    });
    const exportButton = button({
      label: i18n.t("player.export"),
      icon: "export",
      variant: "secondary",
      shortcut: "E",
      class: "hide-narrow-label",
      onClick: () => exporter.open(),
    });
    share.disabled = !shareEnabled;
    exportButton.disabled = !exportEnabled;
    const back = button({
      label: i18n.t("nav.back"),
      icon: "back",
      iconOnly: true,
      variant: "quiet",
      onClick: () => ctx.navigate({ source: null }),
    });
    const root = appBar(ctx, {
      lead: [back, h("div", { class: "player-heading" }, title, meta)],
      actions: [share, exportButton, themeButton(ctx), settingsButton(ctx)],
    });
    root.classList.add("appbar-player");
    return { root, share, export: exportButton };
  };
  let bar = buildBar(false, false);

  // Stage and overlay
  const host = h("div", { class: "stage-host", data: { stageHost: "" } });
  const overlay = h("div", { class: "stage-overlay", attrs: { "aria-live": "polite" } });
  const frame = h("div", { class: "stage-frame", data: { phase } }, host, overlay);

  // Notice (truncated builds)
  const notice = h("div", { class: "player-notice", attrs: { hidden: true, role: "note" } });

  // Scrubber: a seek slider when the player can seek, a progress bar otherwise.
  const scrubber = createScrubber({
    i18n: ctx.i18n,
    seek: (fraction) => session.seek(fraction),
    position: () => session.position,
  });
  const foot = h("div", { class: "player-foot" }, scrubber.root, scrubber.count);

  const root = h(
    "main",
    { class: "view view-player", attrs: { id: "main", tabindex: -1 } },
    bar.root,
    notice,
    frame,
    foot,
  );

  const renderOverlay = (error?: unknown) => {
    const { i18n } = ctx;
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
    document.title = `${opened.title} · ${ctx.i18n.t("app.name")}`;
    bar.share.disabled = false;
  };

  /** What the build leaves out or changes: layers over the limit and the adapter's quality notes. */
  const showNotice = () => {
    const { i18n } = ctx;
    const messages: string[] = [];
    const truncated = session.loaded?.blueprint.truncated;
    if (truncated && truncated.dropped > 0) messages.push(i18n.t("player.truncated", { count: truncated.dropped }));
    // Adapters write the notes in English; the ones Studio knows (font substitutions, Lottie, EPUB,
    // OpenDocument and DOCX notes) are reworded in the UI language, and the lead-in says in that
    // language that they describe changes.
    const notes = session.notes.map((note) => localizeNote(note, i18n));
    if (notes.length > 0) messages.push(i18n.t("player.notes", { notes: notes.join(" ") }));
    if (messages.length === 0) {
      notice.hidden = true;
      return;
    }
    notice.replaceChildren(
      icon("alert", 16),
      h("span", { text: messages.join(" ") }),
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
    locale: ctx.i18n.locale,
    scheme,
    onPhase: (next, error) => {
      phase = next;
      lastError = error;
      // A share link's settings play from the first player on: Studio shows them, and a change of
      // any other setting keeps them.
      const carried = session.opened?.settings;
      if (carried && !sourceSettingsShown) {
        sourceSettingsShown = true;
        ctx.sourceSettings(carried);
      }
      root.dataset.phase = next;
      if (next === "ready" || next === "error") showOpened();
      scrubber.setPhase(next);
      if (next === "ready") {
        showNotice();
        bar.export.disabled = false;
        scrubber.ready(session.canSeek);
        if (autoplayPending) {
          autoplayPending = false;
          session.start();
          return;
        }
      }
      renderOverlay(error);
    },
    onProgress: (built, total) => scrubber.setProgress(built, total),
    onState: (state: PlayerState) => {
      root.dataset.state = state;
      scrubber.setState(state);
    },
    // A choice made on the player's toolbar is the user's setting, like one made in the panel.
    onSettings: (patch) => ctx.updateSettings(patch),
    onClose: () => ctx.navigate({ source: null }),
  });

  // After the session: the dialog reads the settings its preview plays with as it builds.
  const exporter = createExporter({
    ctx,
    opened: () => session.opened,
    settings: () => session.playSettings,
    holdPreview: (hold) => session.hold(hold),
  });
  root.append(exporter.panel.root);

  renderOverlay();
  void session.open();

  async function shareSource(): Promise<void> {
    const { i18n } = ctx;
    const opened = session.opened;
    if (!opened) return;
    // What the preview plays, so the recipient sees the same performance.
    const link = await buildShareLink(opened, session.playSettings, ctx.shareUrl);
    if (!link.ok) {
      ctx.toast.show(i18n.t(shareRefusalKey(link.reason)), { icon: "alert" });
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

  /** A new player takes the change: right away before play, on the user's word once it runs. */
  const rebuildWhenFree = () => {
    if (phase === "ready") {
      session.rebuild(false);
      return;
    }
    if (phase === "playing" || phase === "done") {
      ctx.toast.show(ctx.i18n.t("player.restartHint"), {
        icon: "refresh",
        action: { label: ctx.i18n.t("player.restart"), run: () => session.rebuild(true) },
      });
    }
  };

  /** Puts every Studio string of the view in the current language; the stage keeps playing. */
  const relabel = () => {
    const next = buildBar(!bar.share.disabled, !bar.export.disabled);
    bar.root.replaceWith(next.root);
    bar = next;
    if (session.opened) showOpened();
    else {
      title.textContent = provisionalName(ctx, ref);
      if (guess) meta.textContent = formatLabel(ctx, guess.id);
    }
    if (!notice.hidden) showNotice();
    renderOverlay(lastError);
    scrubber.relabel(ctx.i18n);
    exporter.relabel();
  };

  return {
    root,
    onKey(event) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return false;
      if ((event.key === "e" || event.key === "E") && !bar.export.disabled) {
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
      if (impact === "rebuild") rebuildWhenFree();
    },
    localeChanged() {
      relabel();
      // The core toolbar keeps the old language until the next player.
      if (session.setLocale(ctx.i18n.locale)) rebuildWhenFree();
    },
    schemeChanged: applyScheme,
    destroy() {
      scrubber.destroy();
      exporter.destroy();
      session.destroy();
    },
  };
}
