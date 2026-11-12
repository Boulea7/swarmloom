/**
 * Image types the CLI's Chromium accepts in an `image-set()` option's `type()` (compared in lower
 * case, whole): its supported image MIME types. SVG and JPEG XL are not among them, though Firefox
 * accepts both there.
 */
const CHROMIUM_TYPES = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/jpg",
  "image/webp",
  "image/png",
  "image/apng",
  "image/gif",
  "image/bmp",
  "image/vnd.microsoft.icon",
  "image/x-icon",
  "image/x-xbitmap",
  "image/x-png",
  "image/avif",
]);

/** Device pixels per CSS px of the CLI's browser at `--scale 1`. */
const DEVICE_PIXEL_RATIO = 1;
const IMAGE_SET = /(?:-webkit-)?image-set\(/iy;
const RESOLUTION = /^\+?(\d*\.?\d+(?:e[+-]?\d+)?)(x|dppx|dpi|dpcm)$/i;
const DPPX: Readonly<Record<string, number>> = { x: 1, dppx: 1, dpi: 1 / 96, dpcm: 2.54 / 96 };
const TYPE = /^type\(\s*(["'])(.*)\1\s*\)$/is;

/** One option of an `image-set()`: its image, resolution (as written and in dppx) and type support. */
interface ImageSetOption {
  image: string;
  dppx: number;
  resolution: string | null;
  supported: boolean;
}

/** Index after the CSS string whose opening quote is at `start` (the text's length when unclosed). */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/**
 * The arguments of the function whose `(` ends just before `open`, split at commas outside
 * parentheses and strings, and the index after its `)`; null when it is not closed.
 */
function functionArgs(text: string, open: number): { args: string[]; end: number } | null {
  const args: string[] = [];
  let depth = 0;
  let from = open;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if (c === "\\") i++;
    else if (c === "(") depth++;
    else if (c === ")" && depth-- === 0) {
      args.push(text.slice(from, i));
      return { args, end: i + 1 };
    } else if (c === "," && depth === 0) {
      args.push(text.slice(from, i));
      from = i + 1;
    }
  }
  return null;
}

/** `text` split at white space outside parentheses and strings. */
function words(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (depth === 0 && /\s/.test(c)) {
      if (from >= 0) out.push(text.slice(from, i));
      from = -1;
      continue;
    }
    if (from < 0) from = i;
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if (c === "\\") i++;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  if (from >= 0) out.push(text.slice(from));
  return out;
}

/** One option, or null when it does not parse. */
function parseOption(text: string): ImageSetOption | null {
  const [first, ...rest] = words(text);
  if (!first) return null;
  // A bare string is a URL inside `image-set()` only.
  const image = first.startsWith('"') || first.startsWith("'") ? `url(${first})` : first;
  let dppx = 1;
  let resolution: string | null = null;
  let type: string | null = null;
  for (const word of rest) {
    const res = resolution === null ? RESOLUTION.exec(word) : null;
    if (res) {
      dppx = Number(res[1]) * (DPPX[(res[2] as string).toLowerCase()] ?? 1);
      resolution = word;
      continue;
    }
    const typed: RegExpExecArray | null = type === null ? TYPE.exec(word) : null;
    if (!typed) return null;
    type = (typed[2] as string).toLowerCase();
  }
  return { image, dppx, resolution, supported: type === null || CHROMIUM_TYPES.has(type) };
}

/**
 * The option Chromium shows at {@link DEVICE_PIXEL_RATIO}: of the options with a supported type,
 * the lowest resolution at least that ratio, else the highest; the first of equal resolutions.
 * Null when none is supported.
 */
function chromiumChoice(options: readonly ImageSetOption[]): ImageSetOption | null {
  // A stable sort: options of equal resolution keep their order.
  const sorted = options.filter((o) => o.supported).sort((a, b) => a.dppx - b.dppx);
  const enough = sorted.find((o) => o.dppx >= DEVICE_PIXEL_RATIO);
  if (enough) return enough;
  const highest = sorted[sorted.length - 1];
  return highest ? (sorted.find((o) => o.dppx === highest.dppx) ?? null) : null;
}

/**
 * `css` (computed values) with each `image-set()` replaced by the option the CLI's browser shows:
 * Chromium at one device pixel per CSS px. Every option of a set would otherwise be fetched and
 * embedded in the snapshot, and the browser drawing it would choose among them by its own rules
 * (Firefox accepts SVG and JPEG XL types Chromium skips). A 1x option becomes its image alone,
 * another keeps its resolution in a set of one. A set that does not parse, or has no option of a
 * supported type, is left as it is.
 */
export function pickImageSets(css: string): string {
  if (!css.includes("image-set(")) return css;
  let out = "";
  let copied = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i = stringEnd(css, i) - 1;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    IMAGE_SET.lastIndex = i;
    const fn = IMAGE_SET.exec(css);
    if (!fn || (i > 0 && /[\w-]/.test(css[i - 1] as string))) continue;
    const call = functionArgs(css, i + fn[0].length);
    if (!call) break;
    const options = call.args.map(parseOption);
    const choice = options.every((o) => o !== null) ? chromiumChoice(options as ImageSetOption[]) : null;
    if (choice) {
      const text = choice.dppx === 1 ? choice.image : `${fn[0]}${choice.image} ${choice.resolution})`;
      out += css.slice(copied, i) + text;
      copied = call.end;
    }
    i = call.end - 1;
  }
  return out + css.slice(copied);
}
