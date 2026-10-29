export const EMOJIS: string[] = [
  "😀", "😄", "😁", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😍", "🥰", "😘",
  "😜", "🤪", "🤗", "🤔", "🤨", "😐", "😴", "😪", "😷", "🤒", "🥳", "😎",
  "🤓", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "🫡", "🫠", "🤝",
  "👍", "👎", "👌", "✌️", "🤞", "🙏", "💪", "👏", "🙌", "🔥", "⭐", "✨",
  "💯", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "💕", "💖", "🎉",
  "🎁", "🌹", "🌸", "🍀", "☀️", "🌙", "⚡", "☕", "🍕", "🎂", "⚽", "🏏",
];

export interface GifItem {
  id: string;
  label: string;
  url: string;
}

/** Built-in animated GIF pack served from /public/gifs. */
export const GIF_PACK: GifItem[] = [
  { id: "heart", label: "Heart" },
  { id: "laugh", label: "Laugh" },
  { id: "thumbs", label: "Thumbs up" },
  { id: "clap", label: "Clap" },
  { id: "party", label: "Party" },
  { id: "love", label: "Love" },
  { id: "lol", label: "LOL" },
  { id: "hi", label: "Hi" },
].map((g) => ({ ...g, url: `${import.meta.env.BASE_URL}gifs/${g.id}.gif` }));

const RECENT_CAP = 12;

export function recentStickersKey(userId: string): string {
  return `sa-stickers-recent-${userId}`;
}

/** Most recently used stickers, newest first, capped at 12. */
export function getRecentStickers(userId: string): string[] {
  try {
    const raw = localStorage.getItem(recentStickersKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string").slice(0, RECENT_CAP);
  } catch {
    return [];
  }
}

/** Move a sticker to the front of the recents list (deduped, capped). */
export function addRecentSticker(userId: string, mediaPath: string): string[] {
  const next = [mediaPath, ...getRecentStickers(userId).filter((p) => p !== mediaPath)].slice(0, RECENT_CAP);
  try {
    localStorage.setItem(recentStickersKey(userId), JSON.stringify(next));
  } catch {
    /* storage full/blocked — recents just won't persist */
  }
  return next;
}
