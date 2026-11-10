// Test double of dist/snapshot.js: same global, a blueprint with one text layer per heading.
globalThis.__swarmloomSnapshot = {
  async snapshot(root, options) {
    const layers = [...root.querySelectorAll("h1, h2, p")].map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        id: `l${i}`,
        kind: "text",
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
        html: el.innerHTML,
        text: el.textContent,
        style: {},
      };
    });
    const doc = root.documentElement;
    return {
      version: 1,
      source: options.source,
      size: { w: doc.scrollWidth, h: doc.scrollHeight },
      viewport: { w: innerWidth, h: innerHeight },
      background: getComputedStyle(root.body).backgroundColor,
      layers,
      meta: { hasScreenshot: typeof options.screenshot?.src === "string", dpr: options.screenshot?.dpr },
    };
  },
};
