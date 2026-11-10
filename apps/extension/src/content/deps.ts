/**
 * Real dependencies of a content session: snapshot-dom, the core player, the poster capture via
 * the background, and Studio hand-off. Shared by `swarm.js` and the bundled demo page.
 */

import { createPlayer } from "@swarmloom/core";
import { snapshot } from "@swarmloom/snapshot-dom";
import type { ExtensionApi } from "../shared/api";
import { detectPageCapabilities } from "../shared/capabilities";
import { MSG, parseCaptureReply } from "../shared/messages";
import { capturePoster } from "./poster";
import type { SessionDeps, SnapshotRequest } from "./session";

/** Builds the session dependencies for a page in `view`. `api` is null outside an extension. */
export function contentDeps(api: ExtensionApi | null, view: Window): SessionDeps {
  return {
    snapshot(root, opts: SnapshotRequest) {
      // Passed as a variable: `origin`, `prescroll` and `screenshot` are contract options
      // (contracts/snapshot.ts) that older snapshot-dom typings may not list yet.
      const options = opts;
      return snapshot(root, options);
    },
    createPlayer,
    capturePoster(root, signal) {
      if (!api) return Promise.resolve(null);
      return capturePoster(
        root,
        view,
        {
          async capture() {
            const reply = parseCaptureReply(await api.runtime.sendMessage({ type: MSG.capture }));
            return reply.ok ? reply.dataUrl : null;
          },
        },
        signal,
      );
    },
    openStudio(request) {
      api?.runtime.sendMessage({ type: MSG.openStudio, ...request }).catch(() => undefined);
    },
    audioAvailable: () => detectPageCapabilities(view as unknown as Parameters<typeof detectPageCapabilities>[0]).audio,
  };
}
