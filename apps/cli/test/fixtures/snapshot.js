// Test double of dist/snapshot.js: same global, a blueprint with one text layer per heading.
const frames = async (n) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(() => resolve()));
};

// Like the real pass: scrolls to the end so observers fire, then back.
async function prescroll(doc) {
  const view = doc.defaultView;
  const y = view.scrollY;
  view.scrollTo(0, doc.documentElement.scrollHeight);
  await frames(2);
  view.scrollTo(0, y);
  await frames(2);
}

globalThis.__swarmloomSnapshot = {
  prescroll,
  async snapshot(root, options) {
    if (options.prescroll) await prescroll(root);
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
