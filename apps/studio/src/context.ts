import type { FormatMeta } from "./formats-meta";
import type { StudioI18n } from "./i18n";
import type { Viewport } from "./layout/viewport";
import type { Route } from "./route";
import type { StudioServices } from "./services";
import type { StudioSettings } from "./settings";
import type { LocalInput } from "./source";
import type { Toaster } from "./ui/toast";

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing one. */
  replace?: boolean;
  /** Session-local content for `file` and `launch` routes. */
  local?: LocalInput;
}

/** What every view gets from the app shell. */
export interface AppContext {
  readonly services: StudioServices;
  readonly i18n: StudioI18n;
  readonly toast: Toaster;
  readonly viewport: Viewport;
  /** Current route (parsed from the URL). */
  readonly route: Route;
  /** Persisted settings merged with this visit's URL overrides. */
  readonly settings: StudioSettings;
  /** Colour scheme in effect for the UI and for adapters. */
  readonly scheme: "light" | "dark";
  /** Session-local file or pasted text, if one was opened in this tab. */
  readonly local: LocalInput | null;
  /** Absolute URL of the app page without query or hash (base for share links). */
  readonly appUrl: string;
  /** Changes and persists settings; views are notified through {@link View.settingsChanged}. */
  updateSettings(patch: Partial<StudioSettings>): void;
  /** Goes to another route, keeping the URL in sync. */
  navigate(route: Partial<Route>, opts?: NavigateOptions): void;
  /** Opens the settings drawer (bottom sheet on phones), or closes it when open. */
  toggleSettings(): void;
  /** True while the settings drawer is open. */
  settingsOpen(): boolean;
  /** Opens the keyboard shortcuts dialog. */
  openShortcuts(): void;
  /** Formats this build can open (optional ones only when the formats registry has them). */
  readonly formats: readonly FormatMeta[];
  /** Translated, comma-separated list of the formats Studio opens (for error messages). */
  formatList(): string;
}

/** A top-level screen (home, player, watch). */
export interface View {
  readonly root: HTMLElement;
  /** Studio-level keyboard shortcut; return true when handled. Runs before the player's own keys. */
  onKey?(event: KeyboardEvent): boolean;
  settingsChanged?(prev: StudioSettings, next: StudioSettings): void;
  /** The resolved colour scheme changed (theme setting, or the system theme while on "auto"). */
  schemeChanged?(scheme: "light" | "dark"): void;
  /**
   * The interface language changed and `ctx.i18n` is the new translator. A view that implements
   * this updates its text in place and keeps its state (a running build, typed drafts); a view
   * without it is built again.
   */
  localeChanged?(): void;
  destroy(): void;
}
