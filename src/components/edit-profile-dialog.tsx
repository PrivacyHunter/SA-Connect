import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadFile } from "@/lib/media";
import type { Profile } from "@/lib/types";
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

export function EditProfileDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: Profile;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!displayName.trim() || !username.trim()) {
      toast.error("Name and username are required");
      return;
    }
    setBusy(true);
    try {
      const patch: Partial<Profile> = {
        display_name: displayName.trim(),
        username: username.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""),
        bio,
      };
      if (!patch.username) throw new Error("Invalid username");
      if (avatar) patch.avatar_url = await uploadFile("avatars", avatar);
      if (banner) patch.banner_url = await uploadFile("avatars", banner);
      const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
      if (error) throw error;
      toast.success("Profile updated");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["me", "profile"] });
      qc.invalidateQueries({ queryKey: ["profile", profile.username] });
    } catch (e) {
      const msg =
        e instanceof Error && e.message.includes("duplicate")
          ? "That username is already taken"
          : e instanceof Error
            ? e.message
            : "Could not update profile";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ep-name">Display name</Label>
            <Input id="ep-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ep-user">Username</Label>
            <Input id="ep-user" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ep-bio">Bio</Label>
            <Textarea id="ep-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="cursor-pointer rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground hover:border-gold/60 hover:text-foreground">
              {avatar ? avatar.name : "Choose avatar"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setAvatar(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="cursor-pointer rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground hover:border-gold/60 hover:text-foreground">
              {banner ? banner.name : "Choose banner"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setBanner(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
