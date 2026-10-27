import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MonitorPlay, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCount, formatDuration, timeAgo } from "@/lib/format";
import type { Video } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { MediaImage } from "@/components/media-image";
import { UserAvatar } from "@/components/user-avatar";
import { UploadVideoDialog } from "@/components/upload-video-dialog";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/_authenticated/videos/")({
  head: () => ({
    meta: [
      { title: "Video Hub — SA Connect" },
      { name: "description", content: "Long-form videos, creators and channels on SA Connect." },
      { property: "og:title", content: "Video Hub — SA Connect" },
      { property: "og:description", content: "Long-form videos, creators and channels on SA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VideoHubPage,
});

function VideoHubPage() {
  const [uploadOpen, setUploadOpen] = useState(false);

  const videos = useQuery({
    queryKey: ["videos"],
    queryFn: async (): Promise<Video[]> => {
      const { data, error } = await supabase
        .from("videos")
        .select("*, profiles(*)")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as unknown as Video[];
    },
  });

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="flex items-center justify-between gap-3 py-2">
        <h1 className="font-display text-2xl font-bold">Video Hub</h1>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Upload
        </Button>
      </div>

      {videos.isLoading && <p className="py-6 text-sm text-muted-foreground">Loading videos…</p>}
      {!videos.isLoading && (videos.data ?? []).length === 0 && (
        <EmptyState
          icon={MonitorPlay}
          title="No videos yet"
          hint="Upload the first long-form video and build your channel."
          action={
            <Button onClick={() => setUploadOpen(true)} className="mt-2">
              Upload video
            </Button>
          }
        />
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(videos.data ?? []).map((v) => (
          <Link
            key={v.id}
            to="/videos/$id"
            params={{ id: v.id }}
            className="group overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-gold/50"
          >
            <div className="relative aspect-video bg-secondary">
              <MediaImage
                bucket={v.thumbnail_url ? "media" : null}
                path={v.thumbnail_url}
                alt={v.title}
                className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
              />
              <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {formatDuration(v.duration_seconds)}
              </span>
            </div>
            <div className="flex gap-3 p-3">
              <UserAvatar profile={v.profiles} size="sm" />
              <div className="min-w-0">
                <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{v.title}</h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.profiles.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCount(v.views)} views · {timeAgo(v.created_at)}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <UploadVideoDialog variant="video" open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}
