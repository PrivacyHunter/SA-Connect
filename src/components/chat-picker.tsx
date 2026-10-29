import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadFile } from "@/lib/media";
import { useMediaSrc } from "@/hooks/use-media-url";
import { EMOJIS, GIF_PACK, addRecentSticker, getRecentStickers } from "@/lib/stickers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  meId: string;
  onEmoji: (emoji: string) => void;
  onSticker: (mediaPath: string) => void;
  onGif: (url: string) => void;
};

export function ChatPicker({ meId, onEmoji, onSticker, onGif }: Props) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const recents = useQuery({
    queryKey: ["recent-stickers", meId],
    queryFn: () => getRecentStickers(meId),
    staleTime: Infinity,
  });

  const favorites = useQuery({
    queryKey: ["sticker-favorites", meId],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from("sticker_favorites").select("media_path").eq("user_id", meId);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.media_path));
    },
  });

  const mine = useQuery({
    queryKey: ["my-stickers", meId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("stickers")
        .select("media_path")
        .eq("owner_id", meId)
        .order("created_at", { ascending: false })
        .limit(48);
      if (error) throw error;
      return (data ?? []).map((r) => r.media_path);
    },
  });

  const all = useQuery({
    queryKey: ["all-stickers"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("stickers")
        .select("media_path")
        .order("created_at", { ascending: false })
        .limit(48);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.media_path))];
    },
  });

  function pick(mediaPath: string) {
    qc.setQueryData(["recent-stickers", meId], addRecentSticker(meId, mediaPath));
    onSticker(mediaPath);
  }

  async function toggleFavorite(mediaPath: string) {
    const current = favorites.data ?? new Set<string>();
    if (current.has(mediaPath)) {
      const { error } = await supabase.from("sticker_favorites").delete().eq("user_id", meId).eq("media_path", mediaPath);
      if (error) return void toast.error(error.message);
      const next = new Set(current);
      next.delete(mediaPath);
      qc.setQueryData(["sticker-favorites", meId], next);
    } else {
      const { error } = await supabase.from("sticker_favorites").insert({ user_id: meId, media_path: mediaPath });
      if (error) {
        if (error.code !== "23505") return void toast.error(error.message);
      }
      qc.setQueryData(["sticker-favorites", meId], new Set(current).add(mediaPath));
      toast.success("Saved to favorites");
    }
  }

  /** Turn a gallery image into a sticker and send it right away. */
  async function makeSticker(file: File) {
    setUploading(true);
    try {
      const path = await uploadFile("media", file);
      const { error } = await supabase.from("stickers").insert({ owner_id: meId, media_path: path });
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["my-stickers", meId] });
      void qc.invalidateQueries({ queryKey: ["all-stickers"] });
      pick(path);
      toast.success("Sticker created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create sticker");
    } finally {
      setUploading(false);
    }
  }

  return (
    <PopoverContent side="top" align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
      <Tabs defaultValue="emoji">
        <TabsList className="mx-2 mt-2 grid w-[calc(100%-1rem)] grid-cols-3">
          <TabsTrigger value="emoji">Emoji</TabsTrigger>
          <TabsTrigger value="stickers">Stickers</TabsTrigger>
          <TabsTrigger value="gif">GIFs</TabsTrigger>
        </TabsList>

        <TabsContent value="emoji" className="mt-1 max-h-64 overflow-y-auto px-2 pb-2">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded text-xl hover:bg-accent"
                onClick={() => onEmoji(e)}
                aria-label={`Insert ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="stickers" className="mt-1 max-h-72 space-y-3 overflow-y-auto px-3 pb-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-gold/60 hover:text-foreground">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {uploading ? "Creating sticker…" : "Make sticker from gallery"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.currentTarget.value = "";
                if (f) void makeSticker(f);
              }}
            />
          </label>
          {favorites.data && favorites.data.size > 0 && (
            <StickerSection
              title="Favorites"
              paths={[...favorites.data]}
              favoriteSet={favorites.data}
              onPick={pick}
              onToggleFavorite={toggleFavorite}
            />
          )}
          {(recents.data?.length ?? 0) > 0 && (
            <StickerSection
              title="Recent"
              paths={recents.data ?? []}
              favoriteSet={favorites.data}
              onPick={pick}
              onToggleFavorite={toggleFavorite}
            />
          )}
          {(mine.data?.length ?? 0) > 0 && (
            <StickerSection
              title="My stickers"
              paths={mine.data ?? []}
              favoriteSet={favorites.data}
              onPick={pick}
              onToggleFavorite={toggleFavorite}
            />
          )}
          {(all.data?.length ?? 0) > 0 ? (
            <StickerSection
              title="All stickers"
              paths={all.data ?? []}
              favoriteSet={favorites.data}
              onPick={pick}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            (recents.data?.length ?? 0) === 0 &&
            (mine.data?.length ?? 0) === 0 &&
            (favorites.data?.size ?? 0) === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">Make your first sticker from a gallery photo above.</p>
            )
          )}
        </TabsContent>

        <TabsContent value="gif" className="mt-1 max-h-72 overflow-y-auto px-3 pb-3">
          <div className="grid grid-cols-3 gap-2">
            {GIF_PACK.map((g) => (
              <button
                key={g.id}
                type="button"
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary/40 hover:border-gold/60"
                onClick={() => onGif(g.url)}
                aria-label={`Send ${g.label} GIF`}
              >
                <img src={g.url} alt={g.label} className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {g.label}
                </span>
              </button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </PopoverContent>
  );
}

function StickerSection({
  title,
  paths,
  favoriteSet,
  onPick,
  onToggleFavorite,
}: {
  title: string;
  paths: string[];
  favoriteSet?: Set<string>;
  onPick: (path: string) => void;
  onToggleFavorite: (path: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-4 gap-2">
        {paths.map((path) => (
          <StickerThumb
            key={path}
            path={path}
            favorite={favoriteSet?.has(path) ?? false}
            onPick={() => onPick(path)}
            onToggleFavorite={() => onToggleFavorite(path)}
          />
        ))}
      </div>
    </section>
  );
}

function StickerThumb({
  path,
  favorite,
  onPick,
  onToggleFavorite,
}: {
  path: string;
  favorite: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  const { data: src } = useMediaSrc("media", path);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary/40 hover:border-gold/60">
      {src ? (
        <button type="button" className="h-full w-full" onClick={onPick} aria-label="Send sticker">
          <img src={src} alt="Sticker" className="h-full w-full object-contain" loading="lazy" />
        </button>
      ) : (
        <div className="h-full w-full animate-pulse bg-muted" />
      )}
      <button
        type="button"
        className="absolute bottom-0.5 right-0.5 rounded-full bg-black/55 p-1 text-white hover:bg-black/75"
        onClick={onToggleFavorite}
        aria-label={favorite ? "Remove from favorites" : "Save to favorites"}
        aria-pressed={favorite}
      >
        <Heart className={cn("h-3 w-3", favorite && "fill-gold text-gold")} />
      </button>
    </div>
  );
}
