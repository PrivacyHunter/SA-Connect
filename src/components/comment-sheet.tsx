import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/format";
import type { Comment } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";

export function CommentSheet({
  postId,
  open,
  onOpenChange,
}: {
  postId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const meId = useCurrentId();

  const comments = useQuery({
    queryKey: ["comments", postId],
    queryFn: async (): Promise<Comment[]> => {
      const { data, error } = await supabase
        .from("comments")
        .select("*, profiles(*)")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Comment[];
    },
    enabled: open,
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!body.trim() || !meId) return;
      const { error } = await supabase
        .from("comments")
        .insert({ post_id: postId, author_id: meId, body: body.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["comments", postId] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", postId] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle>Comments</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {comments.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {comments.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet. Be the first!</p>
          )}
          {comments.data?.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5">
              <UserAvatar profile={c.profiles} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{c.profiles.display_name}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                  {c.author_id === meId && (
                    <button
                      onClick={() => remove.mutate(c.id)}
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      aria-label="Delete comment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
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
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment…"
          />
          <Button type="submit" size="icon" disabled={!body.trim() || add.isPending} aria-label="Send comment">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

import { useCurrentUserId } from "@/hooks/use-current-user";
function useCurrentId() {
  return useCurrentUserId();
}
