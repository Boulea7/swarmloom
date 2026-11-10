import { svgAdapter } from "@swarmloom/adapter-svg";
import { expect, test } from "vitest";
import example from "../../../examples/lottie/shuttle-loop.json?raw";
import { loadRuntime } from "../src/render/runtime";

test("probe", async () => {
  const out: string[] = [];
  const log = (v: string) => out.push(v);
  const rt = await loadRuntime();
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:480px;height:300px";
  document.body.appendChild(host);
  const item = rt.loadAnimation({ container: host, renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(example) });
  await new Promise<void>((r) => item.addEventListener("DOMLoaded", () => r()));
  item.goToAndStop(84, true);
  const svg = host.querySelector("svg") as SVGSVGElement;
  const markup = new XMLSerializer().serializeToString(svg);
  log(markup.slice(0, 4000));
  const loaded = await svgAdapter.load({ text: markup, name: "x.svg" }, { document, width: 480, theme: "light" });
  for (const l of loaded.blueprint.layers) {
    const { id, kind, box, opacity, z, priority, role, transform, clip } = l as never as Record<string, unknown>;
    const extra = l.kind === "path" ? { d: l.d.slice(0, 60), stroke: l.stroke, fill: l.fill, reveal: l.reveal, attrs: l.attrs } : l.kind === "text" ? { text: l.text, html: l.html.slice(0, 200), style: l.style } : {};
    log(JSON.stringify({ id, kind, box, opacity, z, priority, role, transform, clip, ...extra }));
  }
  log(JSON.stringify({ bg: loaded.blueprint.background, size: loaded.blueprint.size, trunc: loaded.blueprint.truncated, plugins: loaded.blueprint.plugins }));
  throw new Error(out.join("\n"));
});
