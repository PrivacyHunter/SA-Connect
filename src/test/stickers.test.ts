import { beforeEach, describe, expect, it } from "vitest";
import { addRecentSticker, getRecentStickers } from "@/lib/stickers";
import { formatLastSeen } from "@/lib/format";

describe("sticker recents", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty for a new user", () => {
    expect(getRecentStickers("u1")).toEqual([]);
  });

  it("keeps the newest sticker first and never duplicates one", () => {
    addRecentSticker("u1", "a");
    addRecentSticker("u1", "b");
    addRecentSticker("u1", "a");
    expect(getRecentStickers("u1")).toEqual(["a", "b"]);
  });

  it("caps the list at 12 stickers", () => {
    for (let i = 0; i < 14; i++) addRecentSticker("u1", `p${i}`);
    const recents = getRecentStickers("u1");
    expect(recents).toHaveLength(12);
    expect(recents[0]).toBe("p13");
    expect(recents).not.toContain("p0");
  });

  it("keeps each user's recents separate", () => {
    addRecentSticker("u1", "only-u1");
    expect(getRecentStickers("u2")).toEqual([]);
  });
});

describe("last seen formatting", () => {
  it("says 'today at' with a clock time for same-day sightings", () => {
    const d = new Date();
    d.setHours(11, 0, 0, 0);
    expect(formatLastSeen(d.toISOString())).toMatch(/^today at 11:00/);
  });

  it("says 'yesterday at' for the previous day", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(15, 30, 0, 0);
    expect(formatLastSeen(d.toISOString())).toMatch(/^yesterday at 3:30/);
  });

  it("includes the day's date for older sightings", () => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    d.setHours(9, 2, 0, 0);
    expect(formatLastSeen(d.toISOString())).toMatch(/^[A-Z][a-z]{2} \d{1,2} at 9:02/);
  });
});
