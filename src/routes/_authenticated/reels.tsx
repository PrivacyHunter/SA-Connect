import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clapperboard,
  Disc3,
  Heart,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { useVideoSrc } from "@/components/media-image";
import { formatCount, parseHashtags, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Reel, ReelComment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { UploadVideoDialog } from "@/components/upload-video-dialog";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/_authenticated/reels")({
  head: () => ({
    meta: [
      { title: "Reels — SA Connect" },
      { name: "description", content: "Short vertical videos from the SA Connect community." },
      { property: "og:title", content: "Reels — SA Connect" },
      { property: "og:description", content: "Short vertical videos from the SA Connect community." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReelsPage,
});

function ReelsPage() {
  const { data: me } = useCurrentProfile();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);

  const reels = useQuery({
    queryKey: ["reels"],
    queryFn: async (): Promise<Reel[]> => {
      const { data, error } = await supabase
        .from("reels")
        .select("*, profiles(*), reel_likes(user_id), reel_comments(count)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Reel[];
    },
  });

  return (
    <div className="relative">
      <div className="no-scrollbar snap-y-mandatory h-[calc(100dvh-14.5rem)] overflow-y-auto lg:h-dvh">
        {reels.isLoading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gold" />
          </div>
        )}
        {!reels.isLoading && (reels.data ?? []).length === 0 && (
          <div className="flex h-full items-center justify-center p-4">
            <EmptyState
              icon={Clapperboard}
              title="No reels yet"
              hint="Publish the first short video and start the trend."
              action={
                <Button onClick={() => setUploadOpen(true)} className="mt-2">
                  <Plus className="mr-1 h-4 w-4" /> New reel
                </Button>
              }
            />
          </div>
        )}
        {(reels.data ?? []).map((reel) => (
          <ReelItem
            key={reel.id}
            reel={reel}
            meId={me?.id ?? ""}
            onComments={() => setCommentsFor(reel.id)}
          />
        ))}
      </div>

      <Button
        onClick={() => setUploadOpen(true)}
        className="absolute bottom-4 right-4 z-10 rounded-full shadow-[var(--shadow-glow)]"
      >
        <Plus className="h-4 w-4" /> New reel
      </Button>

      <UploadVideoDialog variant="reel" open={uploadOpen} onOpenChange={setUploadOpen} />
      {commentsFor && <ReelCommentSheet reelId={commentsFor} onClose={() => setCommentsFor(null)} />}
    </div>
  );
}

function ReelItem({ reel, meId, onComments }: { reel: Reel; meId: string; onComments: () => void }) {
  const qc = useQueryClient();
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [popping, setPopping] = useState(false);
  const src = useVideoSrc(reel.video_url);

  const liked = reel.reel_likes.some((l) => l.user_id === meId);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const v = videoRef.current;
        if (!v) return;
        if (entry.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.6 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [src]);

  const toggleLike = useMutation({
    mutationFn: async () => {
      if (liked)
        await supabase.from("reel_likes").delete().eq("reel_id", reel.id).eq("user_id", meId);
      else await supabase.from("reel_likes").insert({ reel_id: reel.id, user_id: meId });
    },
    onSuccess: () => {
      if (!liked) {
        setPopping(true);
        setTimeout(() => setPopping(false), 400);
      }
      qc.invalidateQueries({ queryKey: ["reels"] });
    },
    onError: (e) => toast.error(e.message),
  });

  async function share() {
    const url = `${window.location.origin}/reels`;
    try {
      if (navigator.share) await navigator.share({ title: "SA Connect reel", url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      /* dismissed */
    }
  }

  async function removeReel() {
    if (!confirm("Delete this reel?")) return;
    const { error } = await supabase.from("reels").delete().eq("id", reel.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["reels"] });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  return (
    <div ref={wrapRef} className="snap-item relative flex h-full w-full items-center justify-center bg-black">
      {src ? (
        <video
          ref={videoRef}
          src={src}
          className="h-full w-full object-cover"
          loop
          playsInline
          onClick={togglePlay}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-secondary" />
      )}
      {!playing && (
        <span className="pointer-events-none absolute flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white">
          <Play />
        </span>
      )}

      {/* right overlay */}
      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 text-white">
        <Link to="/profile/$username" params={{ username: reel.profiles.username }}>
          <UserAvatar profile={reel.profiles} showOnline />
        </Link>
        <div className="flex flex-col items-center">
          <button
            onClick={() => toggleLike.mutate()}
            aria-label={liked ? "Unlike" : "Like"}
            className="text-white"
          >
            <Heart
              key={liked ? "l" : "u"}
              className={cn("h-7 w-7", liked && "fill-red-500 text-red-500", popping && "animate-like-pop")}
            />
          </button>
          <span className="text-xs font-semibold">{formatCount(reel.reel_likes.length)}</span>
        </div>
        <div className="flex flex-col items-center">
          <button onClick={onComments} aria-label="Comments" className="text-white">
            <MessageCircle className="h-7 w-7" />
          </button>
          <span className="text-xs font-semibold">{formatCount(reel.reel_comments[0]?.count ?? 0)}</span>
        </div>
        <button onClick={share} aria-label="Share" className="text-white">
          <Share2 className="h-7 w-7" />
        </button>
        {reel.author_id === meId && (
          <button onClick={removeReel} aria-label="Delete reel" className="text-white/80">
            <Trash2 className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* bottom overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pb-6 pr-20 text-white">
        <Link
          to="/profile/$username"
          params={{ username: reel.profiles.username }}
          className="text-sm font-bold hover:underline"
        >
          @{reel.profiles.username}
        </Link>
        <p className="mt-0.5 line-clamp-2 text-sm text-white/90">
          {parseHashtags(reel.caption).map((tok, i) =>
            tok.hashtag ? (
              <span key={i} className="font-semibold text-gold">
                {tok.text}
              </span>
            ) : (
              <span key={i}>{tok.text}</span>
            ),
          )}
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-white/80">
          <Disc3 className="h-5 w-5 animate-spin-slow" />
          <span className="truncate">{reel.music_title ?? "Original sound"}</span>
          <span className="ml-auto shrink-0">{timeAgo(reel.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

function Play(props: Record<string, unknown>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" {...props}>
      <path d="M8 5.14v13.72L19 12 8 5.14z" />
    </svg>
  );
}

function ReelCommentSheet({ reelId, onClose }: { reelId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useCurrentProfile();
  const [body, setBody] = useState("");

  const comments = useQuery({
    queryKey: ["reel-comments", reelId],
    queryFn: async (): Promise<ReelComment[]> => {
      const { data, error } = await supabase
        .from("reel_comments")
        .select("*, profiles(*)")
        .eq("reel_id", reelId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ReelComment[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!body.trim() || !me) return;
      const { error } = await supabase
        .from("reel_comments")
        .insert({ reel_id: reelId, author_id: me.id, body: body.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["reel-comments", reelId] });
      qc.invalidateQueries({ queryKey: ["reels"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle>Comments</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {comments.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {comments.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          )}
          {comments.data?.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5">
              <UserAvatar profile={c.profiles} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{c.profiles.display_name}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
        <form
          className="flex gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" />
          <Button type="submit" size="icon" disabled={!body.trim() || add.isPending} aria-label="Send comment">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
