import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMediaSrc } from "@/hooks/use-media-url";
import { timeAgo } from "@/lib/format";
import type { Story } from "@/lib/types";
import { UserAvatar } from "@/components/user-avatar";

export interface StoryGroup {
  author: Story["profiles"];
  stories: Story[];
}

const STORY_MS = 5000;

export function StoryViewer({
  groups,
  startGroup,
  onClose,
}: {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
}) {
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const group = groups[gi];
  const story = group?.stories[si];

  const next = () => {
    if (!group) return onClose();
    if (si + 1 < group.stories.length) setSi(si + 1);
    else if (gi + 1 < groups.length) {
      setGi(gi + 1);
      setSi(0);
    } else onClose();
  };
  const prev = () => {
    const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
    if (si > 0) setSi(si - 1);
    else if (prevGroup) {
      setGi(gi - 1);
      setSi(prevGroup.stories.length - 1);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gi, si]);

  // auto-advance
  useEffect(() => {
    if (!story) return;
    const timer = setTimeout(next, STORY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  if (!group || !story) return null;
  return <StorySlide story={story} group={group} si={si} onNext={next} onPrev={prev} onClose={onClose} />;
}

function StorySlide({
  story,
  group,
  si,
  onNext,
  onPrev,
  onClose,
}: {
  story: Story;
  group: StoryGroup;
  si: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(story.media_url);
  const { data: src } = useMediaSrc("media", story.media_url);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isVideo && videoRef.current && src) videoRef.current.play().catch(() => {});
  }, [src, isVideo]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user)
        supabase
          .from("story_views")
          .upsert(
            { story_id: story.id, viewer_id: data.user.id },
            { onConflict: "story_id,viewer_id" },
          );
    });
  }, [story.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 text-white/80 hover:text-white"
        aria-label="Close stories"
      >
        <X className="h-7 w-7" />
      </button>

      {/* progress bars */}
      <div className="absolute inset-x-4 top-3 z-10 flex gap-1">
        {group.stories.map((s, i) => (
          <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
            {i < si && <div className="h-full w-full bg-white" />}
            {i === si && (
              <div
                key={s.id}
                className="h-full bg-white"
                style={{ animation: `story-progress ${STORY_MS}ms linear forwards` }}
              />
            )}
          </div>
        ))}
      </div>

      {/* header */}
      <div className="absolute inset-x-4 top-6 z-10 flex items-center gap-3 pt-2 text-white">
        <UserAvatar profile={group.author} size="sm" />
        <div className="text-sm">
          <div className="font-semibold">{group.author.display_name}</div>
          <div className="text-white/60">{timeAgo(story.created_at)}</div>
        </div>
      </div>

      {/* media */}
      <div className="flex h-full w-full items-center justify-center px-2 pb-24 pt-16">
        {isVideo ? (
          <video
            ref={videoRef}
            src={src ?? undefined}
            className="max-h-full max-w-full rounded-2xl"
            playsInline
            onEnded={onNext}
          />
        ) : (
          src && (
            <img
              src={src}
              alt={story.caption ?? "Story"}
              className="max-h-full max-w-full rounded-2xl object-contain"
            />
          )
        )}
      </div>

      {/* tap zones */}
      <button onClick={onPrev} className="absolute inset-y-0 left-0 w-1/3 cursor-default" aria-label="Previous story" />
      <button onClick={onNext} className="absolute inset-y-0 right-0 w-2/3 cursor-default" aria-label="Next story" />
      <ChevronLeft className="pointer-events-none absolute left-2 top-1/2 h-6 w-6 -translate-y-1/2 text-white/50" />
      <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 text-white/50" />

      {/* caption */}
      {story.caption && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-6 pb-10 text-center text-white">
          {story.caption}
        </div>
      )}
    </div>
  );
}
