import type { AppContext } from "../context";
import type { StudioSettings } from "../settings";
import { button } from "../ui/controls";
import { type Child, h } from "../ui/dom";
import { brandMark, type IconName, icon } from "../ui/icons";

const THEME_CYCLE: Record<StudioSettings["theme"], StudioSettings["theme"]> = {
  auto: "light",
  light: "dark",
  dark: "auto",
};
const THEME_ICON: Record<StudioSettings["theme"], IconName> = { auto: "system", light: "sun", dark: "moon" };
const THEME_KEY = { auto: "settings.theme.auto", light: "settings.theme.light", dark: "settings.theme.dark" } as const;

/** Brand lockup: mark, wordmark and the product name. */
export function brand(ctx: AppContext): HTMLElement {
  return h(
    "a",
    {
      class: "brand",
      attrs: { href: "./", "aria-label": ctx.i18n.t("app.name") },
      on: {
        click: (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          ctx.navigate({ source: null });
        },
      },
    },
    brandMark(28),
    h(
      "span",
      { class: "brand-word", attrs: { "aria-hidden": "true" } },
      "SwarmLoom",
      h("span", { class: "brand-product", text: "Studio" }),
    ),
  );
}

/** Cycles the theme setting System, Light, Dark. Marked so the shell can refresh it in place. */
export function themeButton(ctx: AppContext): HTMLButtonElement {
  const el = button({
    label: "",
    icon: "system",
    iconOnly: true,
    variant: "quiet",
    class: "theme-button",
    onClick: () => ctx.updateSettings({ theme: THEME_CYCLE[ctx.settings.theme] }),
  });
  syncThemeButton(ctx, el);
  return el;
}

/** Refreshes the label and icon of a {@link themeButton} after the setting changed (focus is kept). */
export function syncThemeButton(ctx: AppContext, el: HTMLButtonElement): void {
  const theme = ctx.settings.theme;
  const label = ctx.i18n.t("theme.label", { theme: ctx.i18n.t(THEME_KEY[theme]) });
  el.setAttribute("aria-label", label);
  el.title = label;
  el.querySelector("svg")?.replaceWith(icon(THEME_ICON[theme], 20));
}

/** Settings button shared by every view. */
export function settingsButton(ctx: AppContext): HTMLButtonElement {
  return button({
    label: ctx.i18n.t("player.settings"),
    icon: "settings",
    iconOnly: true,
    variant: "quiet",
    shortcut: "S",
    onClick: () => ctx.toggleSettings(),
  });
}

/** Top bar: leading content (brand or back + title) and trailing actions. */
export function appBar(ctx: AppContext, o: { lead?: Child[]; actions?: Child[] } = {}): HTMLElement {
  const lead = o.lead ?? [brand(ctx)];
  const actions = o.actions ?? [
    button({
      label: ctx.i18n.t("shortcuts.show"),
      icon: "keyboard",
      iconOnly: true,
      variant: "quiet",
      shortcut: "?",
      class: "only-pointer",
      onClick: () => ctx.openShortcuts(),
    }),
    themeButton(ctx),
    settingsButton(ctx),
  ];
  return h(
    "header",
    { class: "appbar" },
    h("div", { class: "appbar-lead" }, ...lead),
    h("div", { class: "appbar-actions" }, ...actions),
  );
}

/** Small inline icon + text used for status lines. */
export function statusLine(name: IconName, text: string, className = ""): HTMLElement {
  return h("p", { class: `status-line ${className}`.trim() }, icon(name, 16), h("span", { text }));
}
