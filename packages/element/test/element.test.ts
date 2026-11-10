import { describe, expect, it } from "vitest";
import { define, SwarmLoomElement, TAG_NAME } from "../src/index";

describe("@swarmloom/element", () => {
  it("registers <swarm-loom> idempotently", () => {
    expect(define()).toBe(SwarmLoomElement);
    expect(define()).toBe(SwarmLoomElement);
    expect(document.createElement(TAG_NAME)).toBeInstanceOf(SwarmLoomElement);
  });
});
