import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMediaSrc } from "@/hooks/use-media-url";
import { parseHashtags, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Post } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { CommentSheet } from "@/components/comment-sheet";
import { MediaImage } from "@/components/media-image";

export function PostCard({ post, meId }: { post: Post; meId: string }) {
  const qc = useQueryClient();
  const [slide, setSlide] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [popping, setPopping] = useState(false);

  const liked = post.post_likes.some((l) => l.user_id === meId);
  const saved = post.post_bookmarks.some((b) => b.user_id === meId);
  const media = [...post.post_media].sort((a, b) => a.position - b.position);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["posts"] });

  const toggleLike = useMutation({
    mutationFn: async () => {
      if (liked)
        await supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", meId);
      else await supabase.from("post_likes").insert({ post_id: post.id, user_id: meId });
    },
    onSuccess: () => {
      if (!liked) {
        setPopping(true);
        setTimeout(() => setPopping(false), 400);
      }
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSave = useMutation({
    mutationFn: async () => {
      if (saved)
        await supabase.from("post_bookmarks").delete().eq("post_id", post.id).eq("user_id", meId);
      else await supabase.from("post_bookmarks").insert({ post_id: post.id, user_id: meId });
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  const removePost = useMutation({
    mutationFn: async () => {
      await supabase.from("posts").delete().eq("id", post.id);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  async function share() {
    const url = `${window.location.origin}/feed`;
    try {
      if (navigator.share) await navigator.share({ title: "SA Connect post", url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      /* dismissed */
    }
  }

  const linkMatch = post.caption.match(/https?:\/\/[^\s]+/);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
      <header className="flex items-center gap-3 px-4 py-3">
        <Link to="/profile/$username" params={{ username: post.profiles.username }}>
          <UserAvatar profile={post.profiles} showOnline />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            to="/profile/$username"
            params={{ username: post.profiles.username }}
            className="block truncate text-sm font-semibold hover:underline"
          >
            {post.profiles.display_name}
          </Link>
          <span className="text-xs text-muted-foreground">
            @{post.profiles.username} · {timeAgo(post.created_at)}
          </span>
        </div>
        {meId === post.author_id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Post options">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  if (confirm("Delete this post?")) removePost.mutate();
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete post
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {media.length > 0 && (
        <div className="relative bg-secondary">
          <MediaImage
            bucket="media"
            path={media[slide]?.url}
            alt={post.caption || "Post media"}
            className="max-h-[560px] w-full object-cover"
          />
          {media.length > 1 && (
            <>
              <button
                onClick={() => setSlide((s) => (s - 1 + media.length) % media.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => setSlide((s) => (s + 1) % media.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white"
                aria-label="Next image"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                {media.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-all",
                      i === slide ? "w-4 bg-white" : "bg-white/50",
                    )}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleLike.mutate()}
            aria-label={liked ? "Unlike" : "Like"}
            className="text-foreground"
          >
            <Heart
              key={liked ? "liked" : "unliked"}
              className={cn("h-5 w-5", liked && "fill-red-500 text-red-500", popping && "animate-like-pop")}
            />
          </Button>
          <span className="min-w-6 text-sm tabular-nums">{post.post_likes.length}</span>
          <Button variant="ghost" size="icon" onClick={() => setCommentsOpen(true)} aria-label="Comments">
            <MessageCircle className="h-5 w-5" />
          </Button>
          <span className="min-w-6 text-sm tabular-nums">{post.comments[0]?.count ?? 0}</span>
          <Button variant="ghost" size="icon" onClick={share} aria-label="Share">
            <Share2 className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleSave.mutate()}
            aria-label={saved ? "Remove bookmark" : "Bookmark"}
            className="ml-auto"
          >
            <Bookmark className={cn("h-5 w-5", saved && "fill-gold text-gold")} />
          </Button>
        </div>

        {post.caption && (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {parseHashtags(post.caption).map((tok, i) =>
              tok.hashtag ? (
                <span key={i} className="font-semibold text-gold">
                  {tok.text}
                </span>
              ) : (
                <span key={i}>{tok.text}</span>
              ),
            )}
          </p>
        )}

        {linkMatch && (
          <a
            href={linkMatch[0]}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-secondary/60 p-3 transition-colors hover:border-gold/50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-gold-deep text-xs font-bold text-primary-foreground">
              {new URL(linkMatch[0]).hostname.replace("www.", "")[0]?.toUpperCase() ?? "L"}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {new URL(linkMatch[0]).hostname.replace("www.", "")}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{linkMatch[0]}</span>
            </span>
          </a>
        )}
      </div>

      <CommentSheet postId={post.id} open={commentsOpen} onOpenChange={setCommentsOpen} />
    </article>
  );
}
