import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export function NewChatDialog({
  open,
  onOpenChange,
  meId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meId: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"dm" | "group" | "channel">("dm");
  const [search, setSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const results = useQuery({
    queryKey: ["profile-search", search],
    queryFn: async (): Promise<Profile[]> => {
      // Only your connections are listed; anyone else must be found by exact username.
      let q = supabase.from("profiles").select("*").neq("id", meId).limit(12);
      const s = search.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");
      if (s) q = q.or(`username.ilike.%${s}%,display_name.ilike.%${s}%`);
      const [{ data, error }, exact] = await Promise.all([q, s ? supabase.rpc("find_user_by_username", { p_username: s }) : Promise.resolve({ data: [] as Profile[] })]);
      if (error) throw error;
      const list = (data ?? []) as Profile[];
      for (const p of (exact.data ?? []) as Profile[]) if (p.id !== meId && !list.some((x) => x.id === p.id)) list.unshift(p);
      return list;
    },
    enabled: open,
  });

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function openDm(otherId: string) {
    setBusy(true);
    try {
      const { data: convs } = await supabase
        .from("conversations")
        .select("id, conversation_members(user_id)")
        .eq("type", "dm");
      const found = convs?.find((c) => c.conversation_members.some((m) => m.user_id === otherId));
      if (found) {
        navigate({ to: "/chat/$id", params: { id: found.id } });
        onOpenChange(false);
        return;
      }
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
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/chat/$id", params: { id: conv.id } });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start chat");
    } finally {
      setBusy(false);
    }
  }

  async function createConversation(type: "group" | "channel") {
    const name = (type === "group" ? groupName : channelName).trim();
    if (!name) {
      toast.error("Give it a name");
      return;
    }
    setBusy(true);
    try {
      const { data: conv, error } = await supabase
        .from("conversations")
        .insert({ type, name, created_by: meId })
        .select("id")
        .single();
      if (error) throw error;
      const rows = [{ conversation_id: conv.id, user_id: meId }];
      for (const uid of selected) rows.push({ conversation_id: conv.id, user_id: uid });
      const { error: mErr } = await supabase.from("conversation_members").insert(rows);
      if (mErr) throw mErr;
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/chat/$id", params: { id: conv.id } });
      onOpenChange(false);
      setSelected(new Set());
      setGroupName("");
      setChannelName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a conversation</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dm">Direct</TabsTrigger>
            <TabsTrigger value="group">Group</TabsTrigger>
            <TabsTrigger value="channel">Channel</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab !== "dm" && (
          <Input
            value={tab === "group" ? groupName : channelName}
            onChange={(e) =>
              tab === "group" ? setGroupName(e.target.value) : setChannelName(e.target.value)
            }
            placeholder={tab === "group" ? "Group name" : "Channel name"}
          />
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people by name or @username"
            className="pl-9"
          />
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {results.isLoading && <p className="p-2 text-sm text-muted-foreground">Searching…</p>}
          {results.data?.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">
              No people found. Ask a friend to sign up first.
            </p>
          )}
          {results.data?.map((p) => {
            const isSelected = selected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => (tab === "dm" ? openDm(p.id) : toggle(p.id))}
                disabled={busy}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
                  isSelected ? "bg-primary/15" : "hover:bg-secondary",
                )}
              >
                <UserAvatar profile={p} showOnline />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.display_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{p.username}</span>
                </span>
                {tab === "dm" ? (
                  <MessageHint busy={busy} />
                ) : (
                  isSelected && <span className="text-sm font-semibold text-gold">✓</span>
                )}
              </button>
            );
          })}
        </div>

        {tab !== "dm" && (
          <Button onClick={() => createConversation(tab)} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {tab === "group" ? (
              <>
                <Users className="mr-1 h-4 w-4" /> Create group
              </>
            ) : (
              <>
                <Megaphone className="mr-1 h-4 w-4" /> Create channel
              </>
            )}
            {selected.size > 0 && ` (${selected.size + 1})`}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MessageHint({ busy }: { busy: boolean }) {
  return busy ? <Loader2 className="h-4 w-4 animate-spin text-gold" /> : <span className="text-xs text-muted-foreground">Chat</span>;
}
