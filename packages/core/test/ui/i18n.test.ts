import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOGS, createI18n, LOCALES, type Message, resolveLocale } from "../../src/i18n/index";

const placeholders = (m: Message): string[] => {
  const texts = typeof m === "string" ? [m] : Object.values(m);
  return [...new Set(texts.flatMap((s) => [...(s ?? "").matchAll(/\{(\w+)\}/g)].map((x) => x[1] ?? "")))].sort();
};

describe("message catalogs", () => {
  const reference = CATALOGS.en;
  const keys = Object.keys(reference).sort();

  it.each(LOCALES.filter((l) => l !== "en"))("%s has exactly the English keys and variables", (locale) => {
    const catalog = CATALOGS[locale];
    expect(Object.keys(catalog).sort()).toEqual(keys);
    for (const key of keys) {
      const message = catalog[key as keyof typeof catalog];
      if (typeof message !== "string") expect(message.other, `${locale} ${key}`).toBeTypeOf("string");
      expect(placeholders(message), `${locale} ${key}`).toEqual(placeholders(reference[key as keyof typeof reference]));
    }
  });

  it("covers every role label and format id", () => {
    for (const role of ["layout", "type", "pen", "image", "guide", "copy", "media", "3d"]) {
      expect(reference).toHaveProperty(`role.${role}`);
    }
    const ids = ["dom", "html", "markdown", "docx", "doc", "pdf", "svg", "image", "code", "sheet", "slides", "three"];
    for (const id of ids) expect(reference).toHaveProperty(`format.${id}`);
  });
});

describe("locale resolution", () => {
  it.each([
    ["en", "en"],
    ["fr-CA", "fr"],
    ["de_AT", "de"],
    ["zh", "zh-CN"],
    ["zh-SG", "zh-CN"],
    ["zh-HK", "zh-TW"],
    ["zh-Hant-CN", "zh-TW"],
    ["zh-Hans-TW", "zh-CN"],
    ["ru", "en"],
    ["not a tag!", "en"],
  ])("%s -> %s", (tag, expected) => {
    expect(createI18n(tag).locale).toBe(expected);
  });

  it("walks a preference list in order and defaults to zh-CN without any information", () => {
    expect(resolveLocale(["ru", "ja-JP", "en"])).toBe("ja");
    expect(resolveLocale([])).toBe("zh-CN");
    expect(resolveLocale([42, ""])).toBe("zh-CN");
  });

  describe("without an argument", () => {
    afterEach(() => vi.restoreAllMocks());

    it("uses navigator.languages", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["ko-KR", "en-US"]);
      expect(createI18n().locale).toBe("ko");
    });
  });
});

describe("translation", () => {
  it("interpolates variables with plural selection and locale number formatting", () => {
    const en = createI18n("en");
    expect(en.t("progress.layers", { built: 1, count: 1 })).toBe("1 of 1 layer");
    expect(en.t("progress.layers", { built: 3, count: 1200 })).toBe("3 of 1,200 layers");
    expect(createI18n("de").t("error.truncated", { count: 1500 })).toBe(
      "Zu viel Inhalt: 1.500 Ebenen wurden ausgelassen.",
    );
    expect(createI18n("zh-CN").t("progress.eta", { time: "12 秒" })).toBe("约剩 12 秒");
  });

  it("keeps unknown placeholders and returns unknown keys verbatim", () => {
    const en = createI18n("en");
    expect(en.t("error.loadFailed")).toBe("Couldn't load {name}.");
    expect(en.t("no.such.key")).toBe("no.such.key");
    expect(en.t("progress.layers", { built: 1 })).toBe("1 of {count} layers");
  });
});
