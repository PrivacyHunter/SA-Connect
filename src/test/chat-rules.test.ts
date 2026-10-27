import { describe, expect, it } from "vitest";
import { canDeleteForEveryone, isPremium, messageVisibleTo, oneViewReopenable } from "@/lib/chat-rules";

describe("chat rules", () => {
  it("premium is active only while the subscription is valid", () => {
    expect(isPremium("2099-01-01T00:00:00Z")).toBe(true);
    expect(isPremium("2000-01-01T00:00:00Z")).toBe(false);
    expect(isPremium(null)).toBe(false);
    expect(isPremium(undefined)).toBe(false);
  });

  it("only the sender can delete a message for everyone", () => {
    expect(canDeleteForEveryone("user-a", "user-a")).toBe(true);
    expect(canDeleteForEveryone("user-b", "user-a")).toBe(false);
  });

  it("deleted-for-everyone messages stay visible to premium members only", () => {
    expect(messageVisibleTo(true, false)).toBe(false);
    expect(messageVisibleTo(true, true)).toBe(true);
    expect(messageVisibleTo(false, false)).toBe(true);
  });

  it("view-once media reopens only for premium members", () => {
    expect(oneViewReopenable(false, false)).toBe(true);
    expect(oneViewReopenable(true, false)).toBe(false);
    expect(oneViewReopenable(true, true)).toBe(true);
  });
});
