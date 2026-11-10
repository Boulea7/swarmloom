import type { StudioI18n, StudioKey } from "../i18n";
import { createPanel, type Panel } from "../ui/dialog";
import { h } from "../ui/dom";

/** Studio-level shortcuts, then the core player toolbar's own keys. */
const GROUPS: ReadonlyArray<{ title: StudioKey; keys: ReadonlyArray<[string[], StudioKey]> }> = [
  {
    title: "shortcuts.studio",
    keys: [
      [["O"], "shortcuts.open"],
      [["P"], "shortcuts.paste"],
      [["U"], "shortcuts.url"],
      [["S"], "shortcuts.settings"],
      [["E"], "shortcuts.export"],
      [["?"], "shortcuts.help"],
      [["Esc"], "shortcuts.back"],
    ],
  },
  {
    title: "shortcuts.player",
    keys: [
      [["Space"], "shortcuts.playPause"],
      [["1", "2", "3"], "shortcuts.speed"],
      [["M"], "shortcuts.sound"],
      [["T"], "shortcuts.tour"],
      [["R"], "shortcuts.replay"],
      [["L"], "shortcuts.live"],
    ],
  },
];

/** The keyboard shortcuts dialog. */
export function createShortcuts(i18n: StudioI18n): Panel {
  const panel = createPanel({
    title: i18n.t("shortcuts.title"),
    closeLabel: i18n.t("export.close"),
    class: "panel-dialog panel-shortcuts",
  });
  for (const group of GROUPS) {
    const list = h("dl", { class: "keys" });
    for (const [keys, label] of group.keys) {
      list.append(
        h(
          "div",
          { class: "keys-row" },
          h("dt", {}, ...keys.map((k) => h("kbd", { text: k }))),
          h("dd", { text: i18n.t(label) }),
        ),
      );
    }
    panel.body.append(
      h(
        "section",
        { class: "keys-group" },
        h("h3", { class: "settings-group-title", text: i18n.t(group.title) }),
        list,
      ),
    );
  }
  return panel;
}
