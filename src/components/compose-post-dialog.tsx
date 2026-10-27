import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadFile } from "@/lib/media";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ComposePostDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Not signed in");
      const { data: post, error } = await supabase
        .from("posts")
        .insert({ author_id: data.user.id, caption })
        .select("id")
        .single();
      if (error) throw error;
      for (const [i, file] of files.entries()) {
        const path = await uploadFile("media", file);
        const { error: mErr } = await supabase
          .from("post_media")
          .insert({ post_id: post.id, url: path, position: i });
        if (mErr) throw mErr;
      }
      toast.success("Post shared");
      onOpenChange(false);
      setCaption("");
      setFiles([]);
      qc.invalidateQueries({ queryKey: ["posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not share post");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New post</DialogTitle>
        </DialogHeader>
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="What's on your mind? Use #hashtags and links…"
          rows={4}
        />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative">
                <img
                  src={URL.createObjectURL(f)}
                  alt="Preview"
                  className="h-16 w-16 rounded-lg object-cover"
                />
                <button
                  onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gold hover:underline">
            <ImagePlus className="h-4 w-4" />
            Add photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
            />
          </label>
          <Button onClick={submit} disabled={busy || (!caption.trim() && files.length === 0)}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Share
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
