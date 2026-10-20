import { describe, expect, it } from "vitest";
import { siblingHref } from "../src/lib/programnav";

describe("switching between a family's programs keeps the tab", () => {
  it("rewrites the program id and keeps the segment; an offering page goes to the sibling's overview", () => {
    expect(siblingHref("/programs/a/structure", "a", "b")).toBe("/programs/b/structure");
    expect(siblingHref("/programs/a/goal", "a", "b")).toBe("/programs/b/goal");
    expect(siblingHref("/programs/a", "a", "b")).toBe("/programs/b");
    expect(siblingHref("/programs/a/offerings/x/design", "a", "b")).toBe("/programs/b");
    expect(siblingHref("/somewhere/else", "a", "b")).toBe("/programs/b");
  });
});
