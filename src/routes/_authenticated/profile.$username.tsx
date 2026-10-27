import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clapperboard,
  Film,
  Grid3X3,
  Heart,
  Loader2,
  MessageCircle,
  MonitorPlay,
  Pencil,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { formatCount, parseHashtags, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Award } from "lucide-react";
import { VerificationCard } from "@/components/verification-card";
import { badgeName, experience, levelFromXp, xpForLevel } from "@/lib/levels";
import type { Post, Profile, Reel, Video } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaImage } from "@/components/media-image";
import { UserAvatar } from "@/components/user-avatar";
import { EditProfileDialog } from "@/components/edit-profile-dialog";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/_authenticated/profile/$username")({
  head: () => ({
    meta: [
      { title: "Profile — SA Connect" },
      { name: "description", content: "Creator profiles, posts, reels and videos on SA Connect." },
      { property: "og:title", content: "Profile — SA Connect" },
      { property: "og:description", content: "Creator profiles, posts, reels and videos on SA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});

type TabKey = "posts" | "reels" | "videos" | "liked";

function ProfilePage() {
  const { username } = Route.useParams();
  const qc = useQueryClient();
  const { data: me } = useCurrentProfile();
  const [tab, setTab] = useState<TabKey>("posts");
  const [editOpen, setEditOpen] = useState(false);

  const profile = useQuery({
    queryKey: ["profile", username],
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase.rpc("find_user_by_username", { p_username: username }).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`No user @${username}`);
      return data as Profile;
    },
  });

  const pid = profile.data?.id;
  const isMe = !!me && me.id === pid;

  const stats = useQuery({
    queryKey: ["profile-stats", pid],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("profile_stats", { p: pid! }).maybeSingle();
      if (error) throw error;
      const n = (v: unknown) => Number(v ?? 0);
      const s = { posts: n(data?.posts), reels: n(data?.reels), videos: n(data?.videos), comments: n(data?.comments), followers: n(data?.followers), following: n(data?.following), days: n(data?.days) };
      const level = levelFromXp(experience(s));
      return { ...s, level, badge: badgeName(level), xp: experience(s), next: level < 1000 ? xpForLevel(level + 1) : null };
    },
    enabled: !!pid,
  });

  const followState = useQuery({
    queryKey: ["follow", pid, me?.id],
    queryFn: async (): Promise<boolean> => {
      if (!pid || !me) return false;
      const { data } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("follower_id", me.id)
        .eq("following_id", pid)
        .maybeSingle();
      return !!data;
    },
    enabled: !!pid && !!me && !isMe,
  });

  const toggleFollow = useMutation({
    mutationFn: async () => {
      if (!me || !pid) return;
      if (followState.data)
        await supabase.from("follows").delete().eq("follower_id", me.id).eq("following_id", pid);
      else await supabase.from("follows").insert({ follower_id: me.id, following_id: pid });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow", pid, me?.id] });
      qc.invalidateQueries({ queryKey: ["profile-stats", pid] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (profile.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }
  if (profile.error || !profile.data) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <EmptyState icon={UserMinus} title="Profile not found" hint={`No user @${username} exists yet.`} />
      </div>
    );
  }

  const p = profile.data;

  return (
    <div className="mx-auto max-w-4xl p-4">
      {/* banner */}
      <div className="relative h-36 overflow-hidden rounded-2xl bg-gradient-to-br from-secondary via-card to-secondary sm:h-48">
        <MediaImage
          bucket={p.banner_url ? "avatars" : null}
          path={p.banner_url}
          alt="Profile banner"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="-mt-10 flex flex-wrap items-end gap-4 px-4">
        <span className="rounded-full border-4 border-background">
          <UserAvatar profile={p} size="xl" />
        </span>
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="font-display text-xl font-bold">{p.display_name}</h1>
          <p className="text-sm text-muted-foreground">@{p.username}</p>
        </div>
        <div className="flex gap-2 pb-1">
          {isMe ? (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 h-4 w-4" /> Edit profile
            </Button>
          ) : (
            <>
              <Button
                onClick={() => toggleFollow.mutate()}
                variant={followState.data ? "secondary" : "default"}
              >
                {followState.data ? (
                  <UserMinus className="mr-1 h-4 w-4" />
                ) : (
                  <UserPlus className="mr-1 h-4 w-4" />
                )}
                {followState.data ? "Following" : "Follow"}
              </Button>
              <MessageButton meId={me?.id ?? ""} otherId={p.id} />
            </>
          )}
        </div>
      </div>

      {stats.data && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-3">
          <span className="level-badge"><Award className="h-4 w-4" /> Lv {stats.data.level} · {stats.data.badge}</span>
          <span className="text-xs text-muted-foreground">{stats.data.xp} XP{stats.data.next !== null && ` / ${stats.data.next} for next level`}</span>
        </div>
      )}
      {isMe && <VerificationCard />}
      {p.bio && <p className="mt-3 whitespace-pre-wrap px-4 text-sm">{p.bio}</p>}

      <div className="mt-4 flex gap-6 px-4 text-sm">
        <span>
          <b>{formatCount(stats.data?.posts ?? 0)}</b>{" "}
          <span className="text-muted-foreground">posts</span>
        </span>
        <span>
          <b>{formatCount(stats.data?.followers ?? 0)}</b>{" "}
          <span className="text-muted-foreground">followers</span>
        </span>
        <span>
          <b>{formatCount(stats.data?.following ?? 0)}</b>{" "}
          <span className="text-muted-foreground">following</span>
        </span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="posts">
            <Grid3X3 className="mr-1 inline h-4 w-4" /> Posts
          </TabsTrigger>
          <TabsTrigger value="reels">
            <Clapperboard className="mr-1 inline h-4 w-4" /> Reels
          </TabsTrigger>
          <TabsTrigger value="videos">
            <MonitorPlay className="mr-1 inline h-4 w-4" /> Videos
          </TabsTrigger>
          <TabsTrigger value="liked">
            <Heart className="mr-1 inline h-4 w-4" /> Liked
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4">
        {tab === "posts" && pid && <PostsGrid authorId={pid} />}
        {tab === "reels" && pid && <ReelsGrid authorId={pid} />}
        {tab === "videos" && pid && <VideosGrid channelId={pid} />}
        {tab === "liked" && me && <LikedGrid meId={me.id} />}
      </div>

      {p && <EditProfileDialog profile={p} open={editOpen} onOpenChange={setEditOpen} />}
    </div>
  );
}

function MessageButton({ meId, otherId }: { meId: string; otherId: string }) {
  const navigate = useNavigateRouter();
  const [busy, setBusy] = useState(false);
  async function openDm() {
    setBusy(true);
    try {
      const { data: convs } = await supabase
        .from("conversations")
        .select("id, conversation_members(user_id)")
        .eq("type", "dm");
      const found = convs?.find((c) => c.conversation_members.some((m) => m.user_id === otherId));
      if (found) return navigate({ to: "/chat/$id", params: { id: found.id } });
      const { data: conv, error } = await supabase
        .from("conversations")
        .insert({ type: "dm", created_by: meId })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("conversation_members").insert([
        { conversation_id: conv.id, user_id: meId },
        { conversation_id: conv.id, user_id: otherId },
      ]);
      navigate({ to: "/chat/$id", params: { id: conv.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start chat");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="secondary" onClick={openDm} disabled={busy}>
      <MessageCircle className="mr-1 h-4 w-4" /> Message
    </Button>
  );
}

import { useNavigate as useNavigateRouter } from "@tanstack/react-router";

function PostsGrid({ authorId }: { authorId: string }) {
  const posts = useQuery({
    queryKey: ["profile-posts", authorId],
    queryFn: async (): Promise<Post[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("*, profiles(*), post_media(*), post_likes(user_id), post_bookmarks(user_id), comments(count)")
        .eq("author_id", authorId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Post[];
    },
  });

  if (posts.isLoading) return <GridSkeleton />;
  if ((posts.data ?? []).length === 0)
    return <EmptyState icon={Grid3X3} title="No posts yet" hint="Posts will show up here." />;
  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2">
      {posts.data!.map((post) => {
        const media = [...post.post_media].sort((a, b) => a.position - b.position)[0];
        return (
          <div key={post.id} className="relative aspect-square overflow-hidden rounded-lg bg-secondary">
            {media ? (
              <MediaImage bucket="media" path={media.url} alt={post.caption} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center p-2 text-xs text-muted-foreground">
                <span className="line-clamp-4">{post.caption || "Text post"}</span>
              </div>
            )}
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
              ♥ {post.post_likes.length}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ReelsGrid({ authorId }: { authorId: string }) {
  const reels = useQuery({
    queryKey: ["profile-reels", authorId],
    queryFn: async (): Promise<Reel[]> => {
      const { data, error } = await supabase
        .from("reels")
        .select("*, profiles(*), reel_likes(user_id), reel_comments(count)")
        .eq("author_id", authorId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Reel[];
    },
  });
  if (reels.isLoading) return <GridSkeleton />;
  if ((reels.data ?? []).length === 0)
    return <EmptyState icon={Film} title="No reels yet" hint="Short videos will show up here." />;
  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2">
      {reels.data!.map((r) => (
        <Link key={r.id} to="/reels" className="relative flex aspect-square items-end overflow-hidden rounded-lg bg-gradient-to-b from-secondary to-black/60 p-2">
          <div>
            <p className="line-clamp-2 text-xs font-medium">
              {parseHashtags(r.caption).map((t, i) =>
                t.hashtag ? (
                  <span key={i} className="text-gold">
                    {t.text}
                  </span>
                ) : (
                  <span key={i}>{t.text}</span>
                ),
              ) || "Reel"}
            </p>
            <p className="text-[10px] text-muted-foreground">♥ {r.reel_likes.length}</p>
          </div>
          <Film className="absolute right-2 top-2 h-4 w-4 text-white/70" />
        </Link>
      ))}
    </div>
  );
}

function VideosGrid({ channelId }: { channelId: string }) {
  const videos = useQuery({
    queryKey: ["profile-videos", channelId],
    queryFn: async (): Promise<Video[]> => {
      const { data, error } = await supabase
        .from("videos")
        .select("*, profiles(*)")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Video[];
    },
  });
  if (videos.isLoading) return <GridSkeleton />;
  if ((videos.data ?? []).length === 0)
    return <EmptyState icon={MonitorPlay} title="No videos yet" hint="Long-form videos will show up here." />;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {videos.data!.map((v) => (
        <Link key={v.id} to="/videos/$id" params={{ id: v.id }} className="overflow-hidden rounded-xl bg-card">
          <div className="relative aspect-video bg-secondary">
            <MediaImage
              bucket={v.thumbnail_url ? "media" : null}
              path={v.thumbnail_url}
              alt={v.title}
              className="h-full w-full object-cover"
            />
          </div>
          <p className="line-clamp-1 p-2 text-xs font-semibold">{v.title}</p>
        </Link>
      ))}
    </div>
  );
}

function LikedGrid({ meId }: { meId: string }) {
  const liked = useQuery({
    queryKey: ["liked-posts", meId],
    queryFn: async (): Promise<Post[]> => {
      const { data, error } = await supabase
        .from("post_likes")
        .select(
          "posts(*, profiles(*), post_media(*), post_likes(user_id), post_bookmarks(user_id), comments(count))",
        )
        .eq("user_id", meId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => (row as { posts: Post }).posts);
    },
  });
  if (liked.isLoading) return <GridSkeleton />;
  if ((liked.data ?? []).length === 0)
    return <EmptyState icon={Heart} title="Nothing liked yet" hint="Posts you like will show up here." />;
  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2">
      {liked.data!.map((post) => {
        const media = [...post.post_media].sort((a, b) => a.position - b.position)[0];
        return (
          <div key={post.id} className="relative aspect-square overflow-hidden rounded-lg bg-secondary">
            {media ? (
              <MediaImage bucket="media" path={media.url} alt={post.caption} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center p-2 text-xs text-muted-foreground">
                <span className="line-clamp-4">{post.caption || "Text post"}</span>
              </div>
            )}
            <span className="absolute bottom-1 right-1 text-[10px] text-white">by {post.profiles.display_name}</span>
          </div>
        );
      })}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={cn("aspect-square animate-pulse rounded-lg bg-secondary")} />
      ))}
    </div>
  );
}
