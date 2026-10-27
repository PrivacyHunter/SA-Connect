import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Eye,
  Share2,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { useVideoSrc } from "@/components/media-image";
import { formatCount, formatDuration, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { MediaImage } from "@/components/media-image";
import { UserAvatar } from "@/components/user-avatar";

export const Route = createFileRoute("/_authenticated/videos/$id")({
  head: () => ({
    meta: [
      { title: "Watch — SA Connect" },
      { name: "description", content: "Watch community videos and connect with creators on SA Connect." },
      { property: "og:title", content: "Watch — SA Connect" },
      { property: "og:description", content: "Watch community videos and connect with creators on SA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WatchPage,
});

function WatchPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useCurrentProfile();
  const [expanded, setExpanded] = useState(false);
  const counted = useRef(false);

  const video = useQuery({
    queryKey: ["video", id],
    queryFn: async (): Promise<Video> => {
      const { data, error } = await supabase
        .from("videos")
        .select("*, profiles(*), video_likes(user_id, value), video_bookmarks(user_id)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Video not found");
      return data as Video;
    },
  });

  const mySub = useQuery({
    queryKey: ["my-sub", video.data?.channel_id, me?.id],
    queryFn: async () => {
      const channelId = video.data!.channel_id;
      const { count, error } = await supabase
        .from("subscriptions")
        .select("channel_id", { count: "exact", head: true })
        .eq("subscriber_id", me!.id)
        .eq("channel_id", channelId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!me && !!video.data,
  });

  const related = useQuery({
    queryKey: ["videos"],
    queryFn: async (): Promise<Video[]> => {
      const { data, error } = await supabase
        .from("videos")
        .select("*, profiles(*)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Video[];
    },
  });

  // count one view per session
  useEffect(() => {
    if (!id || counted.current) return;
    const key = `viewed-${id}`;
    if (sessionStorage.getItem(key)) return;
    counted.current = true;
    sessionStorage.setItem(key, "1");
    supabase.rpc("increment_video_views", { p_video_id: id }).then(() => {
      qc.invalidateQueries({ queryKey: ["video", id] });
    });
  }, [id, qc]);

  const v = video.data;
  const myRating = v?.video_likes.find((l) => l.user_id === me?.id)?.value ?? 0;
  const saved = v?.video_bookmarks.some((b) => b.user_id === me?.id) ?? false;
  const subscribed = mySub.data ?? false;
  const src = useVideoSrc(v?.video_url);

  const rate = useMutation({
    mutationFn: async (value: number) => {
      if (!me || !v) return;
      if (myRating === value) {
        await supabase.from("video_likes").delete().eq("video_id", v.id).eq("user_id", me.id);
      } else {
        await supabase.from("video_likes").upsert(
          { video_id: v.id, user_id: me.id, value },
          { onConflict: "video_id,user_id" },
        );
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video", id] }),
    onError: (e) => toast.error(e.message),
  });

  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!me || !v) return;
      if (saved)
        await supabase.from("video_bookmarks").delete().eq("video_id", v.id).eq("user_id", me.id);
      else await supabase.from("video_bookmarks").insert({ video_id: v.id, user_id: me.id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video", id] }),
    onError: (e) => toast.error(e.message),
  });

  const toggleSub = useMutation({
    mutationFn: async () => {
      if (!me || !v) return;
      if (subscribed)
        await supabase.from("subscriptions").delete().eq("channel_id", v.channel_id).eq("subscriber_id", me.id);
      else await supabase.from("subscriptions").insert({ channel_id: v.channel_id, subscriber_id: me.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-sub", v?.channel_id, me?.id] });
      toast.success(subscribed ? "Unsubscribed" : "Subscribed");
    },
    onError: (e) => toast.error(e.message),
  });

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: v?.title ?? "SA Connect video", url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      /* dismissed */
    }
  }

  const likes = v?.video_likes.filter((l) => l.value === 1).length ?? 0;
  const dislikes = v?.video_likes.filter((l) => l.value === -1).length ?? 0;
  const relatedList = (related.data ?? []).filter((r) => r.id !== id).slice(0, 10);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {video.isLoading || !v ? (
          <div className="aspect-video w-full animate-pulse rounded-2xl bg-secondary" />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl bg-black">
              {src ? (
                <video key={id} src={src} controls autoPlay className="aspect-video w-full" />
              ) : (
                <div className="aspect-video w-full animate-pulse bg-secondary" />
              )}
            </div>
            <h1 className="font-display text-xl font-bold leading-snug">{v.title}</h1>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                to="/profile/$username"
                params={{ username: v.profiles.username }}
                className="flex items-center gap-3"
              >
                <UserAvatar profile={v.profiles} showOnline />
                <span>
                  <span className="block text-sm font-semibold hover:underline">
                    {v.profiles.display_name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatCount(v.views)} views · {timeAgo(v.created_at)}
                  </span>
                </span>
              </Link>
              {me?.id !== v.channel_id && (
                <Button onClick={() => toggleSub.mutate()} variant={subscribed ? "secondary" : "default"}>
                  {subscribed ? <UserMinus className="mr-1 h-4 w-4" /> : <UserPlus className="mr-1 h-4 w-4" />}
                  {subscribed ? "Subscribed" : "Subscribe"}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex overflow-hidden rounded-full bg-secondary">
                <Button
                  variant="ghost"
                  onClick={() => rate.mutate(1)}
                  className={cn("rounded-none px-4", myRating === 1 && "text-gold")}
                >
                  <ThumbsUp className="mr-1.5 h-4 w-4" /> {formatCount(likes)}
                </Button>
                <span className="my-2 w-px bg-border" />
                <Button
                  variant="ghost"
                  onClick={() => rate.mutate(-1)}
                  className={cn("rounded-none px-4", myRating === -1 && "text-destructive")}
                >
                  <ThumbsDown className="mr-1.5 h-4 w-4" /> {formatCount(dislikes)}
                </Button>
              </div>
              <Button variant="secondary" onClick={share}>
                <Share2 className="mr-1.5 h-4 w-4" /> Share
              </Button>
              <Button variant="secondary" onClick={() => toggleSave.mutate()}>
                {saved ? (
                  <BookmarkCheck className="mr-1.5 h-4 w-4 text-gold" />
                ) : (
                  <Bookmark className="mr-1.5 h-4 w-4" />
                )}
                {saved ? "Saved" : "Save"}
              </Button>
            </div>
            <div
              className="rounded-2xl border border-border bg-card p-4 text-sm"
              onClick={() => !expanded && setExpanded(true)}
            >
              <p className={cn("whitespace-pre-wrap leading-relaxed", !expanded && "line-clamp-2")}>
                {v.description || "No description provided."}
              </p>
              <button
                className="mt-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((x) => !x);
                }}
              >
                {expanded ? (
                  <>
                    Show less <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    Show more <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* recommended */}
      <aside className="space-y-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Recommended
        </h2>
        {relatedList.map((r) => (
          <button
            key={r.id}
            onClick={() => navigate({ to: "/videos/$id", params: { id: r.id } })}
            className="flex w-full gap-3 rounded-xl p-1 text-left transition-colors hover:bg-secondary"
          >
            <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-secondary">
              <MediaImage
                bucket={r.thumbnail_url ? "media" : null}
                path={r.thumbnail_url}
                alt={r.title}
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] font-semibold text-white">
                {formatDuration(r.duration_seconds)}
              </span>
            </div>
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{r.title}</h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.profiles.display_name}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Eye className="h-3 w-3" /> {formatCount(r.views)} · {timeAgo(r.created_at)}
              </p>
            </div>
          </button>
        ))}
        {relatedList.length === 0 && (
          <p className="text-sm text-muted-foreground">More videos will appear here.</p>
        )}
      </aside>
    </div>
  );
}
