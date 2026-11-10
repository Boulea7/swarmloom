/**
 * Shape of the page copy. One object per locale (zh.ts, en.ts); the renderer never hard-codes words.
 */

export type Locale = "zh" | "en";

/** Formats shown in the strip. The id is also the clip file name (`media/clips/<id>.mp4`). */
export type FormatId =
  | "web"
  | "html"
  | "svg"
  | "markdown"
  | "word"
  | "pdf"
  | "slides"
  | "sheets"
  | "code"
  | "image"
  | "model";

export type DeviceId = "laptop" | "tablet" | "phone" | "foldable" | "watch";

/** Hero install button variants, chosen in CSS from the detected browser (see client/early.ts). */
export type CtaKey = "generic" | "chrome" | "edge" | "brave" | "opera" | "firefox" | "safari" | "studio";

/** Install channels; `data-channel` on <html> highlights the matching install row. */
export type ChannelId = "chromium" | "firefox" | "safari" | "studio" | "cli";

/** A run of headline text; `selected` draws the design-tool selection box around it. */
export interface HeadlineRun {
  text: string;
  selected?: boolean;
}

export interface StepCopy {
  name: string;
  line: string;
}

export interface MakerCard {
  title: string;
  note: string;
  /** Code shown verbatim and copied by the copy button. */
  code: string;
  /** Language hint for the code block label. */
  lang: string;
}

export interface InstallAction {
  label: string;
  /** Link target key, resolved by the renderer against config.ts. */
  target: "releases" | "guide" | "safari-guide" | "studio";
}

export interface InstallRow {
  channel: ChannelId;
  name: string;
  note: string;
  actions: InstallAction[];
  /** Optional copyable command instead of (or next to) buttons. */
  code?: string;
}

/** Availability below full support: `testing` reuses a supported package but is still being verified. */
export type AvailStatus = "planned" | "testing";

/** One availability chip; chips with a status carry its marker. */
export interface AvailItem {
  name: string;
  status?: AvailStatus;
}

export interface PlatformGroup {
  name: string;
  items: AvailItem[];
  note?: string;
}

export interface SiteCopy {
  locale: Locale;
  meta: {
    title: string;
    description: string;
    ogImageAlt: string;
    siteName: string;
  };
  skipLink: string;
  nav: {
    label: string;
    home: string;
    film: string;
    formats: string;
    platforms: string;
    docs: string;
    github: string;
    /** Visible text of the link to the other locale, written in that locale. */
    otherLocale: string;
    otherLocaleShort: string;
  };
  hero: {
    lines: HeadlineRun[][];
    sub: string;
    cta: Record<CtaKey, string>;
    tryOnline: string;
    replay: string;
    replayReduced: string;
  };
  film: {
    title: string;
    play: string;
    playAria: string;
    soon: string;
    error: string;
    frameLabel: string;
    captions: Record<Locale, string>;
    /** Disclosure shown under the film (synthetic voice-over, mascot attribution). */
    credits: string;
  };
  formats: {
    title: string;
    sub: string;
    regionLabel: string;
    prev: string;
    next: string;
    open: string;
    items: Record<FormatId, { name: string; caption: string }>;
  };
  how: {
    title: string;
    steps: [StepCopy, StepCopy, StepCopy];
    export: StepCopy;
  };
  platforms: {
    title: string;
    sub: string;
    lineupLabel: string;
    devices: Record<DeviceId, string>;
    groups: PlatformGroup[];
    /** Marker text per chip status. */
    status: Record<AvailStatus, string>;
  };
  makers: {
    title: string;
    extension: MakerCard;
    element: MakerCard;
    cli: MakerCard;
    copy: string;
    copied: string;
    copyFailed: string;
  };
  install: {
    title: string;
    current: string;
    rows: InstallRow[];
  };
  footer: {
    contactTitle: string;
    credit: string;
    license: string;
    github: string;
  };
  notFound: {
    title: string;
    body: string;
    home: string;
  };
}
