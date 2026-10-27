export const MAX_LEVEL = 1000;

export type ActivityStats = { posts: number; reels: number; videos: number; comments: number; followers: number; days: number };

const TIERS = ["Neon Spark", "Pulse Rookie", "Signal Rider", "Circuit Scout", "Volt Voyager", "Prism Maker", "Nova Creator", "Quantum Voice", "Cyber Legend", "Aurora Icon"];
const RANKS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Experience points earned from real account activity. */
export function experience(s: ActivityStats) {
  return s.posts * 10 + s.reels * 15 + s.videos * 25 + s.comments * 2 + s.followers * 5 + s.days;
}

/** Level 1 on signup, grows with XP, capped at 1000. Level n needs 5*(n-1)^2 XP. */
export function levelFromXp(xp: number) {
  return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(Math.max(0, xp) / 5)) + 1);
}

export function xpForLevel(level: number) {
  return 5 * (level - 1) ** 2;
}

/** Every level from 1 to 1000 has its own unique badge name. */
export function badgeName(level: number) {
  const l = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  const i = l - 1;
  const tier = TIERS[Math.floor(i / 100)];
  const rank = RANKS[Math.floor((i % 100) / 10)];
  return `${tier} ${rank}·${(i % 10) + 1}`;
}
