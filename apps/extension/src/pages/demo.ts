/**
 * Bundled demo page. Browsers do not let an extension script its own pages, so this page runs the
 * swarm itself: through its button, and when the background forwards a toolbar click or the
 * shortcut (`swarmloom:demo-toggle` for this tab).
 */

import { CATALOGS } from "@swarmloom/core";
import { contentDeps } from "../content/deps";
import { toggleSession } from "../content/session";
import type { MessageListener } from "../shared/api";
import { type LaunchRequest, MSG, parseMessage, sessionStrings } from "../shared/messages";
import { loadPrefs } from "../shared/prefs";
import { applyI18n, byId, displayShortcut, onReady, pageContext, toggleShortcut } from "./dom";

onReady(async () => {
  const ctx = await pageContext();
  const { api } = ctx;
  applyI18n(document, ctx.tr);
  const shortcut = await toggleShortcut(api);
  if (shortcut) byId("demo-hint").textContent = ctx.tr.t("demoHint", { shortcut: displayShortcut(shortcut) });

  const deps = contentDeps(api, window);
  const toggle = async () => {
    // Re-read preferences so changes made in the options page apply without a reload.
    const prefs = await loadPrefs(api);
    const launch: LaunchRequest = {
      kind: "page",
      // The page itself is ours; no screenshot is needed for its plain HTML and SVG.
      capture: false,
      prefs,
      locale: ctx.tr.locale,
      strings: sessionStrings(ctx.tr.t),
      playerMessages: CATALOGS[ctx.tr.locale],
    };
    toggleSession(globalThis, document, launch, deps);
  };

  byId<HTMLButtonElement>("demo-start").addEventListener("click", () => void toggle());
  document.querySelector("form.newsletter")?.addEventListener("submit", (e) => e.preventDefault());

  if (!api) return;
  const self = await api.tabs.getCurrent?.();
  const listener: MessageListener = (message, sender) => {
    const msg = parseMessage(message);
    if (sender.id !== api.runtime.id || msg?.type !== MSG.demoToggle || msg.tabId !== self?.id) return undefined;
    void toggle();
    return undefined;
  };
  api.runtime.onMessage.addListener(listener);
});
