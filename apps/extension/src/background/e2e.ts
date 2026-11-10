/**
 * Background entry for `build.mjs --e2e` builds only. Store builds use `index.ts`, so the hook
 * below never ships. It drives the same code paths as a toolbar click.
 */

import { actionApi } from "../shared/api";
import { goLiveSession } from "./injected";
import { startBackground } from "./start";

const started = startBackground();
if (started) {
  const { api, background } = started;
  Object.assign(globalThis, {
    __swarmloomTest: {
      /**
       * Same as a toolbar click. A real click passes a tab whose URL the activeTab grant reveals;
       * `url` stands in for that grant on pages host permissions cannot see (chrome://).
       */
      toggle: async (tabId: number, url?: string) => {
        const tab = await api.tabs.get(tabId);
        return background.handleAction(typeof url === "string" && tab.url === undefined ? { ...tab, url } : tab);
      },
      state: (tabId: number) => background.readState(tabId),
      goLive: async (tabId: number) => {
        const [result] = (await api.scripting?.executeScript({ target: { tabId }, func: goLiveSession })) ?? [];
        return result?.result === true;
      },
      badge: (tabId: number) => actionApi(api)?.getBadgeText?.({ tabId }) ?? Promise.resolve(""),
      capabilities: background.capabilities,
    },
  });
}
