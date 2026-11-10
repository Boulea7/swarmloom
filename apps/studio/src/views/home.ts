import type { AppContext, View } from "../context";
import { describeError, MAX_INPUT_BYTES } from "../errors";
import { type ExampleEntry, entriesForLocale } from "../examples/manifest";
import { acceptAttribute, formatById } from "../formats-meta";
import { normalizeSourceUrl } from "../route";
import { guessPasteName, readLocalFile } from "../source";
import { CURSOR_PALETTE, decorCursor } from "../ui/brand";
import { button, nextId } from "../ui/controls";
import { formatSize, h, isTyping } from "../ui/dom";
import { icon } from "../ui/icons";
import { appBar } from "./chrome";
import { thumbnail } from "./thumb";

/** Formats the paste panel offers explicitly, as file extensions. */
const PASTE_FORMATS = ["md", "html", "svg", "csv", "json", "js", "ts", "py"] as const;

const DECOR_NAMES = ["Ada", "Lin", "Mo"] as const;

/** Translated short name of a format, e.g. "PDF" or "Markdown". */
export function formatLabel(ctx: AppContext, id: string): string {
  const meta = formatById(id);
  return meta ? ctx.i18n.core(`format.${id}`, meta.label) : ctx.i18n.t("format.other");
}

function exampleCard(ctx: AppContext, entry: ExampleEntry, onOpen: (entry: ExampleEntry) => void): HTMLLIElement {
  const { i18n } = ctx;
  const href = `?example=${encodeURIComponent(entry.id)}`;
  const link = h(
    "a",
    {
      class: "card",
      attrs: { href, "aria-label": i18n.t("home.example.play", { title: entry.title }) },
      data: { example: entry.id },
      on: {
        click: (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onOpen(entry);
        },
      },
    },
    h(
      "div",
      { class: "card-thumb" },
      thumbnail(entry, ctx.services.examplesBase),
      h("span", { class: "card-play" }, icon("play", 18)),
    ),
    h(
      "div",
      { class: "card-meta" },
      h("span", { class: "card-title", text: entry.title }),
      h("span", {
        class: "card-sub",
        text: `${formatLabel(ctx, entry.format)} · ${formatSize(entry.size, i18n.locale)}`,
      }),
    ),
  );
  return h("li", { class: "cards-item" }, link);
}

function gallery(ctx: AppContext, onOpen: (entry: ExampleEntry) => void): HTMLElement {
  const { i18n, services } = ctx;
  const entries = entriesForLocale(services.manifest, i18n.locale);
  const headingId = nextId("examples");
  const section = h(
    "section",
    { class: "gallery", attrs: { "aria-labelledby": headingId } },
    h(
      "header",
      { class: "section-head" },
      h("h2", { class: "section-title", attrs: { id: headingId }, text: i18n.t("home.examples") }),
      entries.length > 0
        ? h("span", { class: "section-count", text: i18n.t("home.examples.count", { count: entries.length }) })
        : null,
    ),
  );
  if (entries.length === 0) {
    const empty = h("div", { class: "gallery-empty" }, h("p", { text: i18n.t("home.examples.empty") }));
    if (services.onlineGallery) {
      empty.append(
        h(
          "a",
          { class: "btn btn-secondary", attrs: { href: services.onlineGallery, target: "_blank", rel: "noopener" } },
          h("span", { class: "btn-label", text: i18n.t("home.examples.online") }),
        ),
      );
    }
    section.append(empty);
    return section;
  }
  section.append(
    h("ul", { class: "cards", attrs: { role: "list" } }, ...entries.map((e) => exampleCard(ctx, e, onOpen))),
  );
  return section;
}

/**
 * Home: drop zone with open, paste and URL, then the example gallery. Files dropped or pasted
 * anywhere on the page open directly.
 */
export function createHome(ctx: AppContext): View {
  const { i18n, toast } = ctx;
  const doc = document;
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) => {
    doc.addEventListener(type, fn);
    cleanups.push(() => doc.removeEventListener(type, fn));
  };

  const openFile = async (file: File) => {
    try {
      const local = await readLocalFile(file);
      ctx.navigate({ source: { kind: "file", name: local.name }, autoplay: true }, { local });
    } catch (error) {
      toast.show(describeError(error, i18n, { formats: ctx.formatList(), label: file.name }), { icon: "alert" });
    }
  };

  const picker = h("input", {
    class: "visually-hidden",
    attrs: { type: "file", accept: acceptAttribute(), tabindex: -1, "aria-hidden": "true" },
    on: {
      change: () => {
        const file = picker.files?.[0];
        picker.value = "";
        if (file) void openFile(file);
      },
    },
  });
  const pick = () => picker.click();

  // URL form
  const urlId = nextId("url");
  const urlError = h("p", { class: "field-error", attrs: { id: `${urlId}-error`, hidden: true } });
  const urlInput = h("input", {
    class: "input",
    attrs: {
      id: urlId,
      type: "url",
      inputmode: "url",
      autocomplete: "url",
      spellcheck: "false",
      placeholder: i18n.t("home.url.placeholder"),
      "aria-describedby": `${urlId}-error`,
    },
    on: {
      input: () => {
        urlInput.removeAttribute("aria-invalid");
        urlError.hidden = true;
      },
    },
  });
  const urlForm = h(
    "form",
    {
      class: "url-form",
      attrs: { novalidate: true },
      on: {
        submit: (event) => {
          event.preventDefault();
          const url = normalizeSourceUrl(urlInput.value, ctx.appUrl, {
            allowFileUrls: ctx.services.target === "extension",
          });
          if (!url) {
            urlInput.setAttribute("aria-invalid", "true");
            urlError.textContent = i18n.t("error.url");
            urlError.hidden = false;
            urlInput.focus();
            return;
          }
          ctx.navigate({ source: { kind: "url", url }, autoplay: true });
        },
      },
    },
    h("label", { class: "visually-hidden", attrs: { for: urlId }, text: i18n.t("home.url.label") }),
    h("span", { class: "url-icon" }, icon("link", 18)),
    urlInput,
    button({ label: i18n.t("home.url.submit"), type: "submit", variant: "secondary", class: "url-submit" }),
  );

  // Paste panel (inline, not a modal: it is the next step of the same task)
  const pasteId = nextId("paste");
  const formatId = nextId("paste-format");
  const pasteArea = h("textarea", {
    class: "input paste-area",
    attrs: { id: pasteId, rows: 8, spellcheck: "false", placeholder: i18n.t("home.paste.placeholder") },
  });
  const formatSelect = h(
    "select",
    { class: "select", attrs: { id: formatId } },
    h("option", { attrs: { value: "" }, text: i18n.t("home.paste.auto") }),
  );
  for (const ext of PASTE_FORMATS) formatSelect.append(h("option", { attrs: { value: ext }, text: `.${ext}` }));
  const pastePanel = h(
    "form",
    {
      class: "paste-panel",
      attrs: { hidden: true },
      on: {
        submit: (event) => {
          event.preventDefault();
          const text = pasteArea.value;
          if (text.trim() === "") {
            toast.show(i18n.t("error.paste"), { icon: "alert" });
            pasteArea.focus();
            return;
          }
          const ext = formatSelect.value;
          openText(text, ext ? `pasted.${ext}` : guessPasteName(text));
        },
        keydown: (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            togglePaste(false);
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            pastePanel.requestSubmit();
          }
        },
      },
    },
    h("label", { class: "field-label", attrs: { for: pasteId }, text: i18n.t("home.paste.label") }),
    pasteArea,
    h(
      "div",
      { class: "paste-actions" },
      h(
        "div",
        { class: "field field-row paste-format" },
        h("label", { class: "field-label", attrs: { for: formatId }, text: i18n.t("home.paste.format") }),
        formatSelect,
      ),
      h(
        "div",
        { class: "paste-buttons" },
        button({ label: i18n.t("home.paste.cancel"), variant: "ghost", onClick: () => togglePaste(false) }),
        button({ label: i18n.t("home.paste.submit"), type: "submit", variant: "primary", icon: "play" }),
      ),
    ),
  );
  const pasteButton = button({
    label: i18n.t("home.paste"),
    icon: "paste",
    variant: "secondary",
    shortcut: "P",
    onClick: () => togglePaste(pastePanel.hidden !== false),
  });
  pasteButton.setAttribute("aria-expanded", "false");
  pasteButton.setAttribute("aria-controls", pasteId);
  const togglePaste = (show: boolean) => {
    pastePanel.hidden = !show;
    pasteButton.setAttribute("aria-expanded", String(show));
    if (show) pasteArea.focus();
    else pasteButton.focus();
  };
  const openText = (text: string, name: string) => {
    if (text.length > MAX_INPUT_BYTES) {
      toast.show(
        i18n.t("error.tooLarge", {
          size: formatSize(text.length, i18n.locale),
          limit: formatSize(MAX_INPUT_BYTES, i18n.locale),
        }),
        { icon: "alert" },
      );
      return;
    }
    ctx.navigate({ source: { kind: "file", name }, autoplay: true }, { local: { name, text } });
  };

  // Drop zone
  const cursors = DECOR_NAMES.map((name, i) =>
    decorCursor(name, CURSOR_PALETTE[(i * 2) % CURSOR_PALETTE.length] ?? "#5B5BF7", `decor-${i + 1}`),
  );
  const openButton = button({
    label: i18n.t("home.open"),
    icon: "open",
    variant: "primary",
    shortcut: "O",
    onClick: pick,
  });
  const dropzone = h(
    "div",
    { class: "dropzone", attrs: { role: "group", "aria-label": i18n.t("home.drop.title") } },
    h("div", { class: "dropzone-warp", attrs: { "aria-hidden": "true" } }),
    ...cursors,
    h(
      "div",
      { class: "dropzone-inner" },
      h(
        "p",
        { class: "dropzone-title" },
        h("span", { class: "when-idle", text: i18n.t("home.drop.title") }),
        h("span", { class: "when-drag", text: i18n.t("home.drop.active") }),
      ),
      h("p", {
        class: "dropzone-hint",
        text: i18n.t("home.drop.hint", { limit: formatSize(MAX_INPUT_BYTES, i18n.locale) }),
      }),
      h("div", { class: "dropzone-actions" }, openButton, pasteButton),
    ),
  );

  let dragDepth = 0;
  const setDragging = (on: boolean) => root.classList.toggle("is-dragging", on);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  listen("dragenter", (event) => {
    if (!hasFiles(event)) return;
    dragDepth++;
    setDragging(true);
  });
  listen("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragging(false);
  });
  listen("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  listen("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);
    const file = event.dataTransfer?.files[0];
    if (file) void openFile(file);
  });
  listen("paste", (event) => {
    if (isTyping(event.target)) return;
    const data = event.clipboardData;
    if (!data) return;
    const file = data.files[0];
    if (file) {
      event.preventDefault();
      void openFile(file);
      return;
    }
    const text = data.getData("text/plain");
    if (text.trim() === "") return;
    event.preventDefault();
    const url = /\s/.test(text.trim()) ? null : normalizeSourceUrl(text, ctx.appUrl);
    if (url) ctx.navigate({ source: { kind: "url", url }, autoplay: true });
    else openText(text, guessPasteName(text));
  });

  const onOpen = (entry: ExampleEntry) => ctx.navigate({ source: { kind: "example", id: entry.id }, autoplay: true });

  const main = h(
    "main",
    { class: "home", attrs: { id: "main", tabindex: -1 } },
    h(
      "section",
      { class: "hero" },
      h(
        "div",
        { class: "hero-copy" },
        h("h1", { class: "hero-title", text: i18n.t("app.tagline") }),
        h("p", { class: "hero-lede", text: i18n.t("home.lede") }),
      ),
      h(
        "div",
        { class: "hero-open" },
        dropzone,
        urlForm,
        urlError,
        pastePanel,
        h("p", { class: "privacy" }, icon("lock", 16), h("span", { text: i18n.t("home.privacy") })),
      ),
    ),
    gallery(ctx, onOpen),
    h(
      "footer",
      { class: "home-foot" },
      h("a", {
        attrs: { href: "https://boulea7.github.io/swarmloom/docs/", target: "_blank", rel: "noopener" },
        text: i18n.t("home.footer.docs"),
      }),
      h("a", {
        attrs: { href: "https://boulea7.github.io/swarmloom/docs/guide/cli", target: "_blank", rel: "noopener" },
        text: i18n.t("home.footer.cli"),
      }),
      h("a", {
        attrs: { href: "https://github.com/Boulea7/swarmloom", target: "_blank", rel: "noopener" },
        text: i18n.t("home.footer.source"),
      }),
    ),
  );

  const root = h("div", { class: "view view-home" }, appBar(ctx), main, picker);
  if (ctx.route.import) queueMicrotask(() => openButton.focus());

  return {
    root,
    onKey(event) {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return false;
      const key = event.key.toLowerCase();
      if (key === "o") {
        pick();
        return true;
      }
      if (key === "p") {
        togglePaste(true);
        return true;
      }
      if (key === "u") {
        urlInput.focus();
        return true;
      }
      return false;
    },
    destroy() {
      for (const off of cleanups.splice(0)) off();
    },
  };
}
