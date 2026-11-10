import type { LabelMode, Layer } from "../types";

/**
 * SwarmLoom's own list of 64 short first names from many languages and regions.
 * Order matters: agent `i` gets `AGENT_NAMES[i % 64]`, so the first ones are the most visible.
 */
// biome-ignore format: keep the name grid readable
export const AGENT_NAMES: readonly string[] = [
  "Ada", "Bao", "Cleo", "Dev", "Esme", "Femi", "Gus", "Hana",
  "Ivo", "Jun", "Kai", "Lia", "Milo", "Nia", "Oren", "Pia",
  "Quinn", "Rafa", "Sana", "Teo", "Uma", "Vik", "Wren", "Xin",
  "Yara", "Zeno", "Amir", "Bea", "Chen", "Dara", "Eli", "Fern",
  "Gia", "Hugo", "Iris", "Jae", "Kofi", "Luz", "Mei", "Noor",
  "Otto", "Priya", "Rumi", "Suki", "Tao", "Una", "Vera", "Wim",
  "Yuki", "Zara", "Arlo", "Bo", "Cyra", "Dima", "Enzo", "Faye",
  "Ilse", "Joss", "Kira", "Lars", "Mina", "Nico", "Ola", "Pax",
];

/** What an agent is doing, shown in "roles" label mode through the i18n keys `role.<key>`. */
export type RoleKey = "layout" | "type" | "pen" | "image" | "guide" | "copy" | "media" | "3d";

export const ROLE_KEYS: readonly RoleKey[] = ["layout", "type", "pen", "image", "guide", "copy", "media", "3d"];

const ROLE_BY_TASK: Readonly<Record<string, RoleKey>> = {
  box: "layout",
  text: "type",
  path: "pen",
  image: "image",
  guide: "guide",
  duplicate: "copy",
  media: "media",
};

/** Role of the task that builds `layer` with the choreography `taskKey`. */
export function roleFor(taskKey: string, layer: Layer): RoleKey {
  const direct = ROLE_BY_TASK[taskKey];
  if (direct) return direct;
  if (taskKey.startsWith("three") || layer.role === "mesh") return "3d";
  return "layout";
}

/** "Agent 07" style label (1-based, at least two digits). */
export function agentNumberLabel(index: number): string {
  return `Agent ${String(index + 1).padStart(2, "0")}`;
}

/** Resolves names and tag labels for every label mode. */
export interface Labeler {
  /** Agent name exposed through AgentApi.name and AgentView.name. */
  name(index: number): string;
  /** Tag text for the current role (null while idle); empty hides the tag. */
  label(index: number, role: RoleKey | null): string;
}

/**
 * Creates a {@link Labeler}.
 *
 * @param mode Label mode, or a custom list of labels (cycled; also used as names).
 * @param translate i18n lookup used for role labels (`role.layout`, ...); called once per role.
 */
export function createLabeler(mode: LabelMode | readonly string[], translate: (key: string) => string): Labeler {
  if (typeof mode !== "string") {
    const list = mode.length > 0 ? mode : AGENT_NAMES;
    const at = (index: number): string => list[index % list.length] ?? "";
    return { name: at, label: at };
  }
  const name = (index: number): string => AGENT_NAMES[index % AGENT_NAMES.length] ?? "";
  switch (mode) {
    case "names":
      return { name, label: name };
    case "agents":
      return { name, label: agentNumberLabel };
    case "none":
      return { name, label: () => "" };
    case "roles": {
      const texts = new Map<RoleKey, string>();
      for (const role of ROLE_KEYS) texts.set(role, translate(`role.${role}`));
      return { name, label: (_index, role) => (role ? (texts.get(role) ?? "") : "") };
    }
  }
}
