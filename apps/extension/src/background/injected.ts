/**
 * Functions the background runs in a tab's isolated world through `scripting.executeScript({ func })`.
 *
 * The browser serializes each function's source, so every function here must be self-contained:
 * no imports, no outer variables, no helpers. The global names match `GLOBALS` in
 * shared/messages.ts (test/background.test.ts checks them against a real session object).
 */

interface SessionLike {
  phase?: string;
  error?: string | null;
  stop?: () => void;
  player?: { goLive?: () => void } | null;
}

/** Stops a running session. Returns true when there was one (the click meant "stop"). */
export function stopRunningSession(): boolean {
  const session = (globalThis as { __swarmloomSession?: SessionLike }).__swarmloomSession;
  if (session && session.phase !== "closed" && typeof session.stop === "function") {
    session.stop();
    return true;
  }
  return false;
}

/** Leaves the launch request for `swarm.js`, which consumes and deletes it. */
export function setLaunchRequest(request: unknown): void {
  (globalThis as { __swarmloomLaunch?: unknown }).__swarmloomLaunch = request;
}

/** Asks the tracker (tracker.js, injected first) to find the context-clicked element. */
export function resolveContextTarget(hints: unknown): "found" | "picking" | "missing" {
  const tracker = (globalThis as { __swarmloomTracker?: { resolve?: (h: unknown) => "found" | "picking" } })
    .__swarmloomTracker;
  return typeof tracker?.resolve === "function" ? tracker.resolve(hints) : "missing";
}

/** Test hook (e2e builds): current session phase and error, or null when no session exists. */
export function readSessionState(): { phase: string; error: string | null } | null {
  const session = (globalThis as { __swarmloomSession?: SessionLike }).__swarmloomSession;
  if (!session) return null;
  return { phase: String(session.phase), error: session.error ?? null };
}

/** Test hook (e2e builds): presses "Go live" on the running player. */
export function goLiveSession(): boolean {
  const player = (globalThis as { __swarmloomSession?: SessionLike }).__swarmloomSession?.player;
  if (!player || typeof player.goLive !== "function") return false;
  player.goLive();
  return true;
}
