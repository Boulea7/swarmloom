/**
 * Welcome page, opened once on install: a live `<swarm-loom>` demo of a small card, how to start,
 * how to pin the button in this browser, and links to the demo page, Studio and settings.
 */

import { define } from "@swarmloom/element";
import { BUILD_TARGET, type TargetId } from "../shared/build-info";
import { detectBackgroundCapabilities } from "../shared/capabilities";
import type { MessageKey } from "../shared/i18n";
import { studioUrl } from "../shared/links";
import { applyI18n, byId, displayShortcut, onReady, pageContext, toggleShortcut } from "./dom";

/**
 * Pin instructions per package. The Safari package serves macOS and iOS and the Firefox package
 * serves desktop and Android, so both variants show.
 */
const PIN_KEYS: Readonly<Record<TargetId, readonly MessageKey[]>> = {
  chrome: ["pinChrome", "pinChromiumOthers"],
  edge: ["pinEdge"],
  firefox: ["pinFirefox", "pinFirefoxAndroid"],
  safari: ["pinSafariMac", "pinSafariIos"],
};

onReady(async () => {
  const { api, tr } = await pageContext();
  applyI18n(document, tr);

  try {
    define();
  } catch (e) {
    // Without the element the card stays visible as plain content.
    console.warn("SwarmLoom: <swarm-loom> unavailable", e);
  }

  const pin = byId("pin");
  pin.replaceChildren(
    ...PIN_KEYS[BUILD_TARGET].map((key) => {
      const p = document.createElement("p");
      p.textContent = tr.t(key);
      return p;
    }),
  );

  const shortcut = await toggleShortcut(api);
  const how = byId("how-shortcut");
  how.hidden = shortcut === "";
  how.textContent = tr.t("welcomeHowShortcut", { shortcut: displayShortcut(shortcut) });
  byId("how-menu").hidden = !detectBackgroundCapabilities(api).contextMenus;

  byId<HTMLAnchorElement>("studio").href = studioUrl(api ? (p) => api.runtime.getURL(p) : null);
  byId<HTMLButtonElement>("settings").addEventListener("click", () => {
    void api?.runtime.openOptionsPage();
  });
});
