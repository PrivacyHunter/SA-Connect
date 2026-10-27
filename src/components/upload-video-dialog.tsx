import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { captureVideoThumbnail, readMediaDuration, uploadFile } from "@/lib/media";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/** Upload dialog for both short reels and long-form videos. */
export function UploadVideoDialog({
  variant,
  open,
  onOpenChange,
}: {
  variant: "reel" | "video";
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const isReel = variant === "reel";
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [music, setMusic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCaption("");
    setTitle("");
    setDescription("");
    setMusic("");
    setFile(null);
  }

  async function submit() {
    if (!file) {
      toast.error("Pick a video first");
      return;
    }
    if (!isReel && !title.trim()) {
      toast.error("Give your video a title");
      return;
    }
    setBusy(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Not signed in");
      const videoPath = await uploadFile("media", file);
      const duration = await readMediaDuration(file);

      if (isReel) {
        const { error } = await supabase.from("reels").insert({
          author_id: data.user.id,
          video_url: videoPath,
          caption,
          music_title: music.trim() || null,
        });
        if (error) throw error;
        toast.success("Reel published");
        qc.invalidateQueries({ queryKey: ["reels"] });
      } else {
        let thumbPath: string | null = null;
        const thumb = await captureVideoThumbnail(file);
        if (thumb) thumbPath = await uploadFile("media", thumb);
        const { error } = await supabase.from("videos").insert({
          channel_id: data.user.id,
          title: title.trim(),
          description,
          video_url: videoPath,
          thumbnail_url: thumbPath,
          duration_seconds: duration,
        });
        if (error) throw error;
        toast.success("Video published");
        qc.invalidateQueries({ queryKey: ["videos"] });
      }
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isReel ? "New reel" : "Upload video"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isReel ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="reel-caption">Caption</Label>
                <Textarea
                  id="reel-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Caption with #hashtags…"
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reel-music">Music track</Label>
                <Input
                  id="reel-music"
                  value={music}
                  onChange={(e) => setMusic(e.target.value)}
                  placeholder="e.g. Midnight Drive — Lo-Fi Beats"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="video-title">Title</Label>
                <Input
                  id="video-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Video title"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="video-desc">Description</Label>
                <Textarea
                  id="video-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell viewers about your video…"
                  rows={3}
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Video file</Label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:border-gold/60 hover:text-foreground">
              <Upload className="h-4 w-4" />
              {file ? file.name : "Choose a video (MP4, WebM…)"}
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Max 500 MB. A thumbnail is captured automatically for videos.
            </p>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {isReel ? "Publish reel" : "Publish video"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
