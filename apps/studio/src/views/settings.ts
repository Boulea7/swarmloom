import type { LabelMode } from "@swarmloom/core";
import type { StudioI18n, StudioKey } from "../i18n";
import { LOCALE_NAMES } from "../i18n";
import {
  AGENT_RANGE,
  FINALES,
  FOLLOWS,
  LABEL_MODES,
  MOTIONS,
  parseSeed,
  SOUND_PACKS,
  SPEED_STEPS,
  STUDIO_LOCALES,
  type StudioSettings,
  THEMES,
} from "../settings";
import { button, type Choice, nextId, range, segmented, select, toggle } from "../ui/controls";
import { h } from "../ui/dom";

export interface SettingsFormOptions {
  i18n: StudioI18n;
  settings: StudioSettings;
  onChange(patch: Partial<StudioSettings>): void;
  /** "Restore defaults": the caller resets and renders a fresh form. */
  onReset(): void;
  /** Hide options that make no sense in this view (watch mode hides sound). */
  compact?: boolean;
}

function choices<T extends string>(i18n: StudioI18n, values: readonly T[], prefix: string): Choice<T>[] {
  return values.map((value) => ({ value, label: i18n.t(`${prefix}.${value}` as StudioKey) }));
}

function group(title: string, ...fields: (HTMLElement | null)[]): HTMLElement {
  const id = nextId("settings-group");
  return h(
    "section",
    { class: "settings-group", attrs: { "aria-labelledby": id } },
    h("h3", { class: "settings-group-title", attrs: { id }, text: title }),
    ...fields,
  );
}

/** A 32-bit seed from the platform CSPRNG (UI only; playback timing never uses it). */
function freshSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}

function seedField(o: SettingsFormOptions): HTMLElement {
  const { i18n } = o;
  const id = nextId("seed");
  const hintId = `${id}-hint`;
  const input = h("input", {
    class: "input input-mono",
    attrs: {
      id,
      type: "text",
      inputmode: "numeric",
      autocomplete: "off",
      spellcheck: "false",
      value: String(o.settings.seed),
      "aria-describedby": hintId,
    },
    on: {
      change: () => {
        const seed = parseSeed(input.value.trim());
        if (seed === undefined) {
          input.value = String(o.settings.seed);
          return;
        }
        o.onChange({ seed });
      },
    },
  });
  const shuffle = button({
    label: i18n.t("settings.seed.shuffle"),
    icon: "shuffle",
    iconOnly: true,
    variant: "ghost",
    onClick: () => {
      const seed = freshSeed();
      input.value = String(seed);
      o.onChange({ seed });
    },
  });
  return h(
    "div",
    { class: "field" },
    h("label", { class: "field-label", attrs: { for: id }, text: i18n.t("settings.seed") }),
    h("div", { class: "input-row" }, input, shuffle),
    h("p", { class: "field-hint", attrs: { id: hintId }, text: i18n.t("settings.seed.hint") }),
  );
}

function agentsField(o: SettingsFormOptions): HTMLElement {
  const { i18n, settings } = o;
  const auto = settings.agents === "auto";
  const count = typeof settings.agents === "number" ? settings.agents : 16;
  const slider = range({
    label: i18n.t("settings.agents"),
    min: AGENT_RANGE.min,
    max: AGENT_RANGE.max,
    step: 1,
    value: count,
    format: (v) => String(v),
    onInput: (v) => o.onChange({ agents: v }),
    disabled: auto,
  });
  const autoSwitch = toggle({
    label: i18n.t("settings.agents.auto"),
    checked: auto,
    onChange: (on) => {
      slider.setDisabled(on);
      const output = slider.root.querySelector("output");
      if (output) output.textContent = on ? i18n.t("settings.agents.auto") : slider.input.value;
      o.onChange({ agents: on ? "auto" : Number(slider.input.value) });
    },
  });
  const output = slider.root.querySelector("output");
  if (output && auto) output.textContent = i18n.t("settings.agents.auto");
  return h("div", { class: "field-stack" }, slider.root, autoSwitch);
}

/** Builds the settings form; every control reports through `onChange` immediately. */
export function settingsForm(o: SettingsFormOptions): HTMLElement {
  const { i18n, settings } = o;
  const speedChoices: Choice<string>[] = SPEED_STEPS.map((v) => ({ value: String(v), label: `${v}×` }));
  const speedValue = SPEED_STEPS.includes(settings.speed as (typeof SPEED_STEPS)[number])
    ? String(settings.speed)
    : undefined;

  const swarm = group(
    i18n.t("settings.group.swarm"),
    agentsField(o),
    segmented({
      legend: i18n.t("settings.speed"),
      name: nextId("speed"),
      choices: speedChoices,
      value: speedValue,
      onChange: (v) => o.onChange({ speed: Number(v) }),
    }),
    select<LabelMode>({
      label: i18n.t("settings.labels"),
      choices: choices(i18n, LABEL_MODES, "settings.labels"),
      value: settings.labels,
      onChange: (labels) => o.onChange({ labels }),
    }),
    segmented({
      legend: i18n.t("settings.follow"),
      name: nextId("follow"),
      choices: choices(i18n, FOLLOWS, "settings.follow"),
      value: settings.follow,
      onChange: (follow) => o.onChange({ follow }),
    }),
    segmented({
      legend: i18n.t("settings.finale"),
      name: nextId("finale"),
      choices: choices(i18n, FINALES, "settings.finale"),
      value: settings.finale,
      onChange: (finale) => o.onChange({ finale }),
    }),
  );

  const look = group(
    i18n.t("settings.group.look"),
    segmented({
      legend: i18n.t("settings.theme"),
      name: nextId("theme"),
      choices: choices(i18n, THEMES, "settings.theme"),
      value: settings.theme,
      onChange: (theme) => o.onChange({ theme }),
    }),
    segmented({
      legend: i18n.t("settings.motion"),
      name: nextId("motion"),
      choices: choices(i18n, MOTIONS, "settings.motion"),
      value: settings.reducedMotion,
      onChange: (reducedMotion) => o.onChange({ reducedMotion }),
    }),
  );

  const volume = range({
    label: i18n.t("settings.volume"),
    min: 0,
    max: 1,
    step: 0.05,
    value: settings.volume,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => o.onChange({ volume: v }),
    disabled: !settings.sound,
  });
  const sound = o.compact
    ? null
    : group(
        i18n.t("settings.group.sound"),
        toggle({
          label: i18n.t("settings.sound"),
          checked: settings.sound,
          onChange: (on) => {
            volume.setDisabled(!on);
            o.onChange({ sound: on });
          },
        }),
        select({
          label: i18n.t("settings.pack"),
          choices: choices(i18n, SOUND_PACKS, "settings.pack"),
          value: settings.soundPack,
          onChange: (soundPack) => o.onChange({ soundPack }),
        }),
        volume.root,
      );

  const languages: Choice<StudioSettings["locale"]>[] = [
    { value: "auto", label: i18n.t("settings.theme.auto") },
    ...STUDIO_LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
  ];
  const general = group(
    i18n.t("settings.group.general"),
    select({
      label: i18n.t("settings.language"),
      choices: languages,
      value: settings.locale,
      onChange: (locale) => o.onChange({ locale }),
    }),
    toggle({
      label: i18n.t("settings.remote"),
      hint: i18n.t("settings.remote.hint"),
      checked: settings.remoteAssets,
      onChange: (remoteAssets) => o.onChange({ remoteAssets }),
    }),
    seedField(o),
    h(
      "div",
      { class: "settings-reset" },
      button({ label: i18n.t("settings.reset"), icon: "refresh", variant: "ghost", onClick: () => o.onReset() }),
    ),
  );

  return h(
    "form",
    { class: "settings-form", attrs: { novalidate: true }, on: { submit: (e) => e.preventDefault() } },
    swarm,
    look,
    sound,
    general,
  );
}
