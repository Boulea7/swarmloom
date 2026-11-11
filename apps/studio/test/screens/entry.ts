import "../../src/styles/studio.css";
import rawManifest from "virtual:studio-examples";
import { mountStudio } from "../../src/app";
import { sanitizeManifest } from "../../src/examples/manifest";
import { fakeServices } from "../fakes";

/**
 * Screenshot page (dev server only, never built): the real Studio UI with the repository examples
 * and a fake player, since core's player is still a stub. Driven by scripts/screens.mjs.
 */
const root = document.getElementById("app");
if (!root) throw new Error("#app is missing");
const { services } = fakeServices({
  manifest: sanitizeManifest(rawManifest),
  examplesBase: new URL(`${import.meta.env.BASE_URL}examples/`, window.location.href).href,
});
void mountStudio(root, services).then(() => {
  document.documentElement.dataset.screensReady = "true";
});
