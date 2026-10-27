import { describe, expect, it } from "vitest";
import {
  batchFor,
  CREDITS_PER_BATCH,
  CREDIT_TASKS,
  MESSAGE_BATCH_SIZE,
  REFERRAL_REWARD,
  taskDone,
} from "@/lib/credits";

describe("credit batches", () => {
  it("starts every account in the Starter batch", () => {
    expect(batchFor(0).name).toBe("Starter");
    expect(batchFor(0).index).toBe(0);
  });

  it("assigns a new batch after 500 credits and restarts the counter", () => {
    expect(batchFor(CREDITS_PER_BATCH).name).toBe("Bronze");
    expect(batchFor(CREDITS_PER_BATCH).progress).toBe(0);
  });

  it("counts progress toward the next batch", () => {
    expect(batchFor(999).name).toBe("Bronze");
    expect(batchFor(999).progress).toBe(499);
    expect(batchFor(999).toNext).toBe(1);
  });
});

describe("credit tasks", () => {
  it("grants 50 welcome credits for creating an account", () => {
    expect(CREDIT_TASKS.find((t) => t.reason === "signup")?.amount).toBe(50);
  });

  it("rewards 10 credits per friend who joins with the referral code", () => {
    expect(REFERRAL_REWARD).toBe(10);
  });

  it("rewards credits for every 10 messages sent", () => {
    expect(MESSAGE_BATCH_SIZE).toBe(10);
  });

  it("one-time tasks complete once; repeatable tasks never complete", () => {
    expect(taskDone(new Set(["first_post"]), "first_post")).toBe(true);
    expect(taskDone(new Set(), "first_post")).toBe(false);
    expect(taskDone(new Set(["messages_10"]), "messages_10")).toBe(false);
    expect(taskDone(new Set(["referral:x"]), "referral")).toBe(false);
  });
});
