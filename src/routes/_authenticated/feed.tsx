import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Newspaper, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { uploadFile } from "@/lib/media";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Post, Story } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PostCard } from "@/components/post-card";
import { ComposePostDialog } from "@/components/compose-post-dialog";
import { StoryViewer, type StoryGroup } from "@/components/story-viewer";
import { UserAvatar } from "@/components/user-avatar";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/_authenticated/feed")({
  head: () => ({
    meta: [
      { title: "Feed — SA Connect" },
      { name: "description", content: "Stories, posts and conversations from the people you follow." },
      { property: "og:title", content: "Feed — SA Connect" },
      { property: "og:description", content: "Stories, posts and conversations from the people you follow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FeedPage,
});

function FeedPage() {
  const { data: me } = useCurrentProfile();
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [storyCaption, setStoryCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const myStoryInput = useRef<HTMLInputElement>(null);

  const posts = useQuery({
    queryKey: ["posts"],
    queryFn: async (): Promise<Post[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select(
          "*, profiles(*), post_media(*), post_likes(user_id), post_bookmarks(user_id), comments(count)",
        )
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as Post[];
    },
  });

  const stories = useQuery({
    queryKey: ["stories"],
    queryFn: async (): Promise<Story[]> => {
      const { data, error } = await supabase
        .from("stories")
        .select("*, profiles(*)")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Story[];
    },
  });

  const viewed = useQuery({
    queryKey: ["story-views"],
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return new Set();
      const { data: rows } = await supabase
        .from("story_views")
        .select("story_id")
        .eq("viewer_id", data.user.id);
      return new Set((rows ?? []).map((r) => r.story_id));
    },
  });

  const groups = useMemo<StoryGroup[]>(() => {
    const map = new Map<string, StoryGroup>();
    for (const s of stories.data ?? []) {
      if (!map.has(s.author_id)) map.set(s.author_id, { author: s.profiles, stories: [] });
      map.get(s.author_id)!.stories.push(s);
    }
    return [...map.values()];
  }, [stories.data]);

  async function addStory() {
    if (!storyFile || !me) return;
    setBusy(true);
    try {
      const path = await uploadFile("media", storyFile);
      const { error } = await supabase.from("stories").insert({
        author_id: me.id,
        media_url: path,
        caption: storyCaption.trim() || null,
      });
      if (error) throw error;
      toast.success("Story added");
      setStoryOpen(false);
      setStoryFile(null);
      setStoryCaption("");
      qc.invalidateQueries({ queryKey: ["stories"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add story");
    } finally {
      setBusy(false);
    }
  }

  const myStory = stories.data?.find((s) => s.author_id === me?.id);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      {/* Stories row */}
      <div className="flex gap-4 overflow-x-auto pb-1 no-scrollbar">
        {/* my story */}
        <button
          className="flex w-16 flex-col items-center gap-1"
          onClick={() => (myStory ? setViewer(-1) : myStoryInput.current?.click())}
        >
          <span className="relative">
            {me && <UserAvatar profile={me} size="lg" />}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-primary to-gold-deep text-primary-foreground">
              <Plus className="h-3 w-3" />
            </span>
          </span>
          <span className="truncate text-[11px] text-muted-foreground">Your story</span>
        </button>
        <input
          ref={myStoryInput}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            setStoryFile(e.target.files?.[0] ?? null);
            setStoryOpen(true);
          }}
        />
        {groups.map((g, i) => {
          const unviewed = g.stories.some((s) => !viewed.data?.has(s.id));
          return (
            <button
              key={g.author.id}
              className="flex w-16 flex-col items-center gap-1"
              onClick={() => setViewer(i)}
            >
              <span
                className={cn(
                  "rounded-full p-[2.5px]",
                  unviewed
                    ? "bg-gradient-to-tr from-gold to-gold-deep"
                    : "bg-border",
                )}
              >
                <span className="block rounded-full border-2 border-background">
                  <UserAvatar profile={g.author} size="lg" />
                </span>
              </span>
              <span className="w-16 truncate text-[11px] text-muted-foreground">
                {g.author.display_name.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </div>

      {/* compose */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
        {me && <UserAvatar profile={me} showOnline />}
        <button
          onClick={() => setComposeOpen(true)}
          className="flex-1 rounded-xl bg-secondary px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
        >
          What's on your mind?
        </button>
        <Button onClick={() => setComposeOpen(true)} size="sm" variant="secondary">
          <Camera className="h-4 w-4" /> Post
        </Button>
      </div>

      {/* posts */}
      {posts.isLoading && <p className="text-sm text-muted-foreground">Loading feed…</p>}
      {!posts.isLoading && (posts.data ?? []).length === 0 && (
        <EmptyState
          icon={Newspaper}
          title="Your feed is empty"
          hint="Share your first post, add a story — or follow people to fill this space."
          action={
            <Button onClick={() => setComposeOpen(true)} className="mt-2">
              <Sparkles className="mr-1 h-4 w-4" /> Create first post
            </Button>
          }
        />
      )}
      <div className="space-y-4">
        {(posts.data ?? []).map((p) => me && <PostCard key={p.id} post={p} meId={me.id} />)}
      </div>

      <ComposePostDialog open={composeOpen} onOpenChange={setComposeOpen} />

      {viewer !== null && groups.length > 0 && (
        <StoryViewer
          groups={groups}
          startGroup={(viewer + groups.length) % groups.length}
          onClose={() => setViewer(null)}
        />
      )}

      {/* add story dialog */}
      <Dialog open={storyOpen} onOpenChange={setStoryOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to your story</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {storyFile && /\.(mp4|webm|mov|m4v)$/i.test(storyFile.name) ? (
              <video src={URL.createObjectURL(storyFile)} controls className="max-h-64 w-full rounded-xl" />
            ) : storyFile ? (
              <img src={URL.createObjectURL(storyFile)} alt="Story preview" className="max-h-64 w-full rounded-xl object-cover" />
            ) : null}
            <Input
              value={storyCaption}
              onChange={(e) => setStoryCaption(e.target.value)}
              placeholder="Caption (optional)"
            />
            <div className="flex justify-between text-sm">
              <button
                className="font-medium text-gold hover:underline"
                onClick={() => myStoryInput.current?.click()}
              >
                Change media
              </button>
              <Button onClick={addStory} disabled={!storyFile || busy}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Share story
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stories disappear 24 hours after posting. · {timeAgo(new Date().toISOString()) === "just now" ? "Fresh" : ""}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
