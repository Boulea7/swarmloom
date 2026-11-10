import type { Message } from "../format";

/**
 * English catalog: the reference key set. Every other catalog is typed as {@link Catalog}, so a
 * missing or extra key is a compile error; test/ui/i18n.test.ts checks the same at runtime.
 *
 * Conventions: `{name}` is a variable; plural messages select on `{count}`.
 */
export const en = {
  "toolbar.label": "Build controls",
  "toolbar.play": "Play",
  "toolbar.pause": "Pause",
  "toolbar.resume": "Resume",
  "toolbar.speed": "Speed",
  "toolbar.speedOption": "{speed}× speed",
  "toolbar.sound": "Sound",
  "toolbar.tapForSound": "Tap for sound",
  "toolbar.soundLocked": "The browser blocks sound until you tap",
  "toolbar.tour": "Tour",
  "toolbar.tourHint": "Scroll along with the build",
  "toolbar.replay": "Replay",
  "toolbar.goLive": "Go live",
  "toolbar.goLiveHint": "Show the final result",
  "toolbar.close": "Close",
  "toolbar.record": "Record",
  "toolbar.shortcut": "{label} ({key})",
  "key.space": "Space",
  "key.esc": "Esc",

  "progress.label": "Build progress",
  "progress.preparing": "Getting ready…",
  "progress.layers": { one: "{built} of {count} layer", other: "{built} of {count} layers" },
  "progress.eta": "About {time} left",
  "progress.etaPaused": "Paused, about {time} left",
  "progress.done": { one: "{count} layer built", other: "{count} layers built" },
  "time.seconds": { one: "{count} second", other: "{count} seconds" },
  "time.minutes": { one: "{count} minute", other: "{count} minutes" },

  "announce.start": { one: "Building {count} layer", other: "Building {count} layers" },
  "announce.half": "Halfway there",
  "announce.done": "Build complete",

  "role.layout": "Layout",
  "role.type": "Type",
  "role.pen": "Pen",
  "role.image": "Image",
  "role.guide": "Guide",
  "role.copy": "Copy",
  "role.media": "Media",
  "role.3d": "3D",

  "format.dom": "Web page",
  "format.markdown": "Markdown",
  "format.html": "HTML",
  "format.docx": "Word document",
  "format.doc": "Word 97-2003 document",
  "format.pdf": "PDF",
  "format.svg": "SVG",
  "format.slides": "Presentation",
  "format.sheet": "Spreadsheet",
  "format.code": "Source code",
  "format.image": "Image",
  "format.three": "3D model",

  "error.restricted": "SwarmLoom can't run on this page.",
  "error.restrictedHint": "Open it in SwarmLoom Studio instead.",
  "error.unsupported": "This file type isn't supported yet.",
  "error.unsupportedFile": "{name} isn't a supported file type.",
  "error.tooLarge": "This file is too large. The limit is {limit}.",
  "error.truncated": {
    one: "Too much to build in full: {count} layer was left out.",
    other: "Too much to build in full: {count} layers were left out.",
  },
  "error.loadFailed": "Couldn't load {name}.",
  "error.generic": "Something went wrong.",
  "action.openInStudio": "Open in Studio",
  "action.retry": "Try again",
} satisfies Record<string, Message>;

/** Every message key. */
export type MessageKey = keyof typeof en;

/** A complete catalog for one locale. */
export type Catalog = Readonly<Record<MessageKey, Message>>;
