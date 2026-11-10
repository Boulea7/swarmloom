/**
 * Options page: every preference is saved as soon as it changes (storage.local, mirrored to
 * storage.sync) and applies the next time the swarm starts.
 */

import type { ExtensionApi } from "../shared/api";
import { BUILD_TARGET, engineOf } from "../shared/build-info";
import { fileAccessState } from "../shared/capabilities";
import {
  browserLanguages,
  createTranslator,
  LOCALE_NAMES,
  LOCALES,
  type MessageKey,
  resolveLocale,
} from "../shared/i18n";
import {
  DEFAULT_PREFS,
  FINALES,
  LABEL_MODES,
  MOTION_PREFS,
  type Prefs,
  SOUND_PACKS,
  sanitizePrefs,
  savePrefs,
  THEMES,
} from "../shared/prefs";
import { applyI18n, byId, displayShortcut, onReady, pageContext, toggleShortcut } from "./dom";

type Choice = { value: string; key?: MessageKey; text?: string; lang?: string };
type T = (key: MessageKey, vars?: Readonly<Record<string, string | number>>) => string;

const AGENT_CHOICES = [8, 16, 24, 32, 48, 64];

const LABEL_KEYS: Record<string, MessageKey> = {
  names: "optLabelsNames",
  agents: "optLabelsAgents",
  roles: "optLabelsRoles",
  none: "optLabelsNone",
};
const THEME_KEYS: Record<string, MessageKey> = { auto: "optThemeAuto", light: "optThemeLight", dark: "optThemeDark" };
const PACK_KEYS: Record<string, MessageKey> = {
  studio: "optPackStudio",
  soft: "optPackSoft",
  "8bit": "optPack8bit",
  "silent-keys": "optPackSilentKeys",
};
const FINALE_KEYS: Record<string, MessageKey> = {
  flock: "optFinaleFlock",
  halo: "optFinaleHalo",
  none: "optFinaleNone",
};
const MOTION_KEYS: Record<string, MessageKey> = { auto: "optMotionAuto", on: "optMotionOn", off: "optMotionOff" };

function choices(values: readonly string[], keys: Record<string, MessageKey>): Choice[] {
  return values.map((value) => ({ value, key: keys[value] }));
}

function fillSelect(select: HTMLSelectElement, list: Choice[], value: string, t: T): void {
  select.replaceChildren(
    ...list.map((c) => {
      const option = document.createElement("option");
      option.value = c.value;
      option.textContent = c.key ? t(c.key) : (c.text ?? c.value);
      if (c.lang) option.lang = c.lang;
      return option;
    }),
  );
  select.value = value;
}

interface Form {
  speed: HTMLInputElement;
  speedOut: HTMLOutputElement;
  agents: HTMLSelectElement;
  finale: HTMLSelectElement;
  labels: HTMLSelectElement;
  theme: HTMLSelectElement;
  sound: HTMLInputElement;
  soundPack: HTMLSelectElement;
  volume: HTMLInputElement;
  volumeOut: HTMLOutputElement;
  reducedMotion: HTMLSelectElement;
  locale: HTMLSelectElement;
}

function formElements(): Form {
  return {
    speed: byId<HTMLInputElement>("speed"),
    speedOut: byId<HTMLOutputElement>("speed-out"),
    agents: byId<HTMLSelectElement>("agents"),
    finale: byId<HTMLSelectElement>("finale"),
    labels: byId<HTMLSelectElement>("labels"),
    theme: byId<HTMLSelectElement>("theme"),
    sound: byId<HTMLInputElement>("sound"),
    soundPack: byId<HTMLSelectElement>("soundPack"),
    volume: byId<HTMLInputElement>("volume"),
    volumeOut: byId<HTMLOutputElement>("volume-out"),
    reducedMotion: byId<HTMLSelectElement>("reducedMotion"),
    locale: byId<HTMLSelectElement>("locale"),
  };
}

function render(form: Form, prefs: Prefs, t: T): void {
  const agents = typeof prefs.agents === "number" ? prefs.agents : null;
  const agentValues =
    agents === null || AGENT_CHOICES.includes(agents)
      ? AGENT_CHOICES
      : [...AGENT_CHOICES, agents].sort((a, b) => a - b);
  fillSelect(
    form.agents,
    [{ value: "auto", key: "optAgentsAuto" }, ...agentValues.map((n) => ({ value: String(n), text: String(n) }))],
    String(prefs.agents),
    t,
  );
  fillSelect(form.finale, choices(FINALES, FINALE_KEYS), prefs.finale, t);
  fillSelect(form.labels, choices(LABEL_MODES, LABEL_KEYS), prefs.labels, t);
  fillSelect(form.theme, choices(THEMES, THEME_KEYS), prefs.theme, t);
  fillSelect(form.soundPack, choices(SOUND_PACKS, PACK_KEYS), prefs.soundPack, t);
  fillSelect(form.reducedMotion, choices(MOTION_PREFS, MOTION_KEYS), prefs.reducedMotion, t);
  fillSelect(
    form.locale,
    [{ value: "auto", key: "optLanguageAuto" }, ...LOCALES.map((l) => ({ value: l, text: LOCALE_NAMES[l], lang: l }))],
    prefs.locale,
    t,
  );
  form.speed.value = String(prefs.speed);
  form.sound.checked = prefs.sound;
  form.volume.value = String(prefs.volume);
  updateOutputs(form);
}

function updateOutputs(form: Form): void {
  form.speedOut.value = `${Number(form.speed.value)}x`;
  form.volumeOut.value = `${Math.round(Number(form.volume.value) * 100)}%`;
  form.soundPack.disabled = !form.sound.checked;
  form.volume.disabled = !form.sound.checked;
}

function readForm(form: Form): Prefs {
  return sanitizePrefs({
    speed: Number(form.speed.value),
    agents: form.agents.value === "auto" ? "auto" : Number(form.agents.value),
    finale: form.finale.value,
    labels: form.labels.value,
    theme: form.theme.value,
    sound: form.sound.checked,
    soundPack: form.soundPack.value,
    volume: Number(form.volume.value),
    reducedMotion: form.reducedMotion.value,
    locale: form.locale.value,
  });
}

async function setupAccess(api: ExtensionApi | null, t: T): Promise<void> {
  const engine = engineOf(BUILD_TARGET);
  const shortcut = await toggleShortcut(api);
  byId("shortcut-text").textContent = shortcut
    ? t("optShortcutHint", { shortcut: displayShortcut(shortcut) })
    : t("optShortcutNone");
  const change = byId<HTMLButtonElement>("shortcut-change");
  const openSettings = api?.commands?.openShortcutSettings;
  // Chromium opens its shortcut page from a tab; Firefox 137+ has a dedicated API.
  change.hidden = !api?.commands || !(engine === "chromium" || typeof openSettings === "function");
  change.onclick = () => {
    if (!api) return;
    if (typeof openSettings === "function") void openSettings.call(api.commands);
    else void api.tabs.create({ url: "chrome://extensions/shortcuts" });
  };

  const state = api ? await fileAccessState(api) : "unsupported";
  byId("file-access").hidden = state === "unknown";
  byId("file-access-text").textContent = t(
    state === "granted"
      ? "optFileAccessGranted"
      : state === "unsupported"
        ? "optFileAccessUnsupported"
        : "optFileAccessDenied",
  );
  const details = byId<HTMLButtonElement>("file-access-open");
  details.hidden = !(state === "denied" && engine === "chromium");
  details.onclick = () => {
    if (api) void api.tabs.create({ url: `chrome://extensions/?id=${api.runtime.id}` });
  };
}

onReady(async () => {
  const ctx = await pageContext();
  const { api } = ctx;
  let prefs = ctx.prefs;
  let tr = ctx.tr;
  const form = formElements();
  const formEl = byId<HTMLFormElement>("prefs");
  const status = byId("status");
  let saveTimer = 0;

  const paint = () => {
    applyI18n(document, tr);
    render(form, prefs, tr.t);
    void setupAccess(api, tr.t);
  };
  paint();

  const save = async () => {
    const next = readForm(form);
    const localeChanged = next.locale !== prefs.locale;
    prefs = next;
    if (localeChanged) {
      tr = createTranslator(resolveLocale(prefs.locale, browserLanguages()));
      paint();
      form.locale.focus();
    }
    if (!api) return;
    try {
      await savePrefs(api, prefs);
      status.textContent = tr.t("optSaved");
    } catch (e) {
      status.textContent = tr.t("optSaveFailed", { message: e instanceof Error ? e.message : String(e) });
    }
  };

  formEl.addEventListener("submit", (e) => e.preventDefault());
  formEl.addEventListener("input", (e) => {
    updateOutputs(form);
    // Range inputs fire continuously while dragging; save once the hand rests.
    const delay = (e.target as HTMLInputElement).type === "range" ? 300 : 0;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), delay);
  });
  byId<HTMLButtonElement>("reset").addEventListener("click", () => {
    prefs = { ...DEFAULT_PREFS, locale: prefs.locale };
    render(form, prefs, tr.t);
    void save();
  });
  byId<HTMLButtonElement>("open-welcome").addEventListener("click", () => {
    if (api) void api.tabs.create({ url: api.runtime.getURL("welcome.html") });
  });
});
