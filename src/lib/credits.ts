/** Pure credits rules: batches, tasks and referral rewards. */

export const CREDITS_PER_BATCH = 500;
export const REFERRAL_REWARD = 10;
export const MESSAGE_BATCH_SIZE = 10;
export const MESSAGE_BATCH_REWARD = 10;

export const BATCH_NAMES = [
  "Starter",
  "Bronze",
  "Silver",
  "Gold",
  "Sapphire",
  "Ruby",
  "Platinum",
  "Diamond",
  "Elite",
  "Legend",
] as const;

export interface CreditBatch {
  index: number;
  name: string;
  /** Credits earned inside the current batch cycle. */
  progress: number;
  /** Credits still needed to reach the next batch. */
  toNext: number;
}

/** Batches are derived from total credits earned: every 500 credits starts a new batch. */
export function batchFor(totalCredits: number): CreditBatch {
  const total = Math.max(0, Math.floor(totalCredits));
  const index = Math.floor(total / CREDITS_PER_BATCH);
  const cycle = Math.floor(index / BATCH_NAMES.length);
  const base = BATCH_NAMES[index % BATCH_NAMES.length] ?? "Starter";
  return {
    index,
    name: cycle > 0 ? `${base} ${cycle + 1}` : base,
    progress: total % CREDITS_PER_BATCH,
    toNext: CREDITS_PER_BATCH - (total % CREDITS_PER_BATCH),
  };
}

export interface CreditTask {
  reason: string;
  label: string;
  amount: number;
  repeatable?: boolean;
}

/** One-time tasks + repeatable earners shown on the Credits page. */
export const CREDIT_TASKS: CreditTask[] = [
  { reason: "signup", label: "Create your account", amount: 50 },
  { reason: "first_pic", label: "Add your first profile picture", amount: 10 },
  { reason: "first_post", label: "Share your first post", amount: 20 },
  { reason: "first_reel", label: "Upload your first reel", amount: 20 },
  { reason: "first_video", label: "Publish your first video", amount: 20 },
  { reason: "first_listing", label: "List your first marketplace product", amount: 20 },
  { reason: "messages_10", label: `Every ${MESSAGE_BATCH_SIZE} messages you send`, amount: MESSAGE_BATCH_REWARD, repeatable: true },
  { reason: "referral", label: "A friend joins with your referral code", amount: REFERRAL_REWARD, repeatable: true },
];

/** Whether a one-time task has been completed given the earned event reasons. */
export function taskDone(reasons: Iterable<string>, reason: string): boolean {
  if (reason === "messages_10" || reason === "referral") return false; // repeatable tasks never "complete"
  for (const r of reasons) if (r === reason) return true;
  return false;
}
