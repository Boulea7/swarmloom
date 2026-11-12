import { expect, it } from "vitest";
import { readStored } from "../src/stored";

/** A promise-based storage area holding `data`, as `browser.storage.*` and Chromium's `chrome.storage.*`. */
function promiseArea(data: Record<string, unknown>) {
  return {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    remove: async (key: string) => void delete data[key],
  };
}

/** Firefox's `chrome.storage.*`: callback-based, so a call without a callback returns undefined. */
const callbackArea = { get: () => undefined, remove: () => undefined };

const take = { name: "note.md", text: "# hi" };

it.each([
  [
    "Firefox (promises on browser, callbacks on chrome)",
    (local: Record<string, unknown>) => ({
      browser: { storage: { session: promiseArea({}), local: promiseArea(local) } },
      chrome: { storage: { session: callbackArea, local: callbackArea } },
    }),
  ],
  [
    "Chromium (promises on chrome)",
    (local: Record<string, unknown>) => ({ chrome: { storage: { local: promiseArea(local) } } }),
  ],
])("reads and removes a handoff entry in %s", async (_, scopeFor) => {
  const local: Record<string, unknown> = { take };
  const scope = scopeFor(local) as Parameters<typeof readStored>[1];

  await expect(readStored("take", scope)).resolves.toEqual(take);
  expect(local).toEqual({});
  await expect(readStored("take", scope)).resolves.toBeNull();
});

it("rejects an entry with more than one payload", async () => {
  const scope = { chrome: { storage: { local: promiseArea({ take: { ...take, url: "https://a.test/" } }) } } };
  await expect(readStored("take", scope as Parameters<typeof readStored>[1])).resolves.toBeNull();
});
