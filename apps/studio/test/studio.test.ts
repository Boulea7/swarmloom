import { describe, expect, it } from "vitest";
import { mountStudio } from "../src/app";

describe("studio", () => {
  it("renders the placeholder shell", () => {
    const root = document.createElement("div");
    mountStudio(root);
    expect(root.querySelector("h1")?.textContent).toBe("SwarmLoom Studio");
  });
});
