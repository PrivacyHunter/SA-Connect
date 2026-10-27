import { describe, expect, it } from "vitest";
import { badgeName, levelFromXp, MAX_LEVEL } from "@/lib/levels";

describe("levels", () => {
  it("new accounts start at level 1", () => expect(levelFromXp(0)).toBe(1));
  it("caps at level 1000", () => expect(levelFromXp(1e12)).toBe(MAX_LEVEL));
  it("gives all 1000 levels a unique badge", () => {
    const names = new Set(Array.from({ length: 1000 }, (_, i) => badgeName(i + 1)));
    expect(names.size).toBe(1000);
  });
});
