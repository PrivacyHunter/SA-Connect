import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellOff,
  Check,
  ListChecks,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Megaphone,
  Search,
  Trash2,
  Users,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { decryptStoredText } from "@/lib/e2ee";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { NewChatDialog } from "@/components/new-chat-dialog";
import { EmptyState } from "@/components/empty-state";

const TABS = [
  { key: "dm", label: "Direct Messages", icon: MessagesSquare, empty: "No conversations yet" },
  { key: "group", label: "Groups", icon: Users, empty: "No groups yet" },
  { key: "channel", label: "Channels", icon: Megaphone, empty: "No channels yet" },
] as const;

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({
    meta: [
      { title: "Chat — SA Connect" },
      { name: "description", content: "Direct messages, groups and broadcast channels in SA Connect." },
      { property: "og:title", content: "Chat — SA Connect" },
      { property: "og:description", content: "Direct messages, groups and broadcast channels in SA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatListPage,
});

function ChatListPage() {
  const { data: me } = useCurrentProfile();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("dm");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, conversation_members!inner(user_id, last_read_at, muted, deleted_at, profiles(*))")
        .filter("conversation_members.deleted_at", "is", null)
        .eq("conversation_members.user_id", me?.id ?? "")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      const rows = (data ?? []) as Conversation[];
      // Encrypted previews are decrypted locally with the conversation key.
      return Promise.all(rows.map(async (c) => {
        if (c.last_message_body?.startsWith("enc:")) {
          return { ...c, last_message_body: (await decryptStoredText(c.id, me?.id ?? "", c.last_message_body)) ?? "Encrypted message" };
        }
        return c;
      }));
    },
    enabled: !!me,
  });

  const list = (conversations.data ?? [])
    .filter((c) => c.type === tab)
    .filter((c) => {
      const s = search.trim().toLowerCase();
      if (!s) return true;
      return displayName(c, me?.id ?? "").toLowerCase().includes(s);
    });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function deleteSelected() {
    if (!me || selected.size === 0) return;
    setDeleting(true);
    try {
      for (const convId of selected) {
        // Hide the conversation from my list (reappears if the other person writes again),
        // and clear the history from my side.
        const { error } = await supabase
          .from("conversation_members")
          .update({ deleted_at: new Date().toISOString() })
          .eq("conversation_id", convId)
          .eq("user_id", me.id);
        if (error) throw error;
        await supabase.rpc("clear_chat", { p_conversation: convId });
      }
      toast.success(selected.size === 1 ? "Chat deleted" : `${selected.size} chats deleted`);
      exitSelectMode();
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete chats");
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-3xl flex-col p-4 lg:h-dvh">
      <div className="flex items-center justify-between gap-3 py-2">
        {selectMode ? (
          <>
            <h1 className="font-display text-xl font-bold">
              {selected.size === 0 ? "Select chats" : `${selected.size} selected`}
            </h1>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete selected chats"
                disabled={selected.size === 0 || deleting}
                onClick={() => setConfirmOpen(true)}
              >
                {deleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5 text-destructive" />}
              </Button>
              <Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={exitSelectMode}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Chats</h1>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Select chats"
                disabled={list.length === 0}
                onClick={() => {
                  setSelectMode(true);
                  setSelected(new Set());
                }}
              >
                <ListChecks className="h-5 w-5" />
              </Button>
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> New
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="relative py-2">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats"
          className="pl-9"
        />
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto pb-4">
        {conversations.isLoading && (
          <p className="p-4 text-sm text-muted-foreground">Loading chats…</p>
        )}
        {!conversations.isLoading && list.length === 0 && (
          <EmptyState
            icon={MessageCircle}
            title={TABS.find((t) => t.key === tab)!.empty}
            hint="Only your saved contacts and people you already chat with appear here."
            action={
              <Button onClick={() => setNewOpen(true)} className="mt-2">
                Start a conversation
              </Button>
            }
          />
        )}
        {list.map((c) => {
          const other = c.type === "dm" ? c.conversation_members.find((m) => m.user_id !== me?.id) : null;
          const mine = c.conversation_members.find((m) => m.user_id === me?.id);
          const unread =
            !!c.last_message_at &&
            (!mine?.last_read_at || new Date(c.last_message_at) > new Date(mine.last_read_at));
          const isSelected = selected.has(c.id);

          if (selectMode) {
            return (
              <button
                key={c.id}
                onClick={() => toggleSelect(c.id)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
                  )}
                  aria-hidden
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </span>
                {other ? (
                  <UserAvatar profile={other.profiles} showOnline />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-gold">
                    {c.type === "group" ? <Users className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", isSelected ? "font-bold" : "font-semibold")}>
                    {displayName(c, me?.id ?? "")}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.last_message_body ? (c.type === "channel" ? "📣 " : "") + c.last_message_body : "Say hello 👋"}
                  </span>
                </span>
              </button>
            );
          }

          return (
            <Link
              key={c.id}
              to="/chat/$id"
              params={{ id: c.id }}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-secondary"
            >
              {other ? (
                <UserAvatar profile={other.profiles} showOnline />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-gold">
                  {c.type === "group" ? <Users className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", unread ? "font-bold" : "font-semibold")}>
                    {displayName(c, me?.id ?? "")}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {timeAgo(c.last_message_at)}
                  </span>
                </span>
                <span
                  className={cn(
                    "block truncate text-xs",
                    unread ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {c.last_message_body ? (c.type === "channel" ? "📣 " : "") + c.last_message_body : "Say hello 👋"}
                </span>
              </span>
            {mine?.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Muted chat" />}
            {unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-gold" />}
            </Link>
          );
        })}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size === 1 ? "this chat" : `${selected.size} chats`}?</AlertDialogTitle>
            <AlertDialogDescription>
              The chat disappears from your list and its history is cleared from your side. If they message you
              again, the chat reappears. The other person keeps their own copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void deleteSelected();
              }}
            >
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {me && <NewChatDialog open={newOpen} onOpenChange={setNewOpen} meId={me.id} />}
    </div>
  );
}

function displayName(c: Conversation, meId: string): string {
  if (c.type === "dm") {
    const other = c.conversation_members.find((m) => m.user_id !== meId);
    return other?.profiles.display_name ?? "Direct message";
  }
  return c.name ?? (c.type === "group" ? "Group" : "Channel");
}
