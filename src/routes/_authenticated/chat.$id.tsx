import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pin,
  Play,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { usePremium } from "@/hooks/use-premium";
import { useMediaSrc } from "@/hooks/use-media-url";
import { uploadFile } from "@/lib/media";
import { decryptStoredText, encryptText } from "@/lib/e2ee";
import { oneViewReopenable } from "@/lib/chat-rules";
import { formatClockTime, formatDuration, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Conversation, Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { CallOverlay, useCall } from "@/components/call-overlay";
import { Phone, Video } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chat/$id")({
  head: () => ({
    meta: [
      { title: "Conversation — SA Connect" },
      { name: "description", content: "Your messages and shared moments on SA Connect." },
      { property: "og:title", content: "Conversation — SA Connect" },
      { property: "og:description", content: "Your messages and shared moments on SA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useCurrentProfile();
  const { premium } = usePremium(me?.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [oneView, setOneView] = useState(false);
  const [pending, setPending] = useState<{ file: File; kind: "image" | "file"; url: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const call = useCall(id, me?.id);

  const conv = useQuery({
    queryKey: ["conversation", id],
    queryFn: async (): Promise<Conversation | null> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, conversation_members(user_id, last_read_at, muted, profiles(*))")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Conversation | null;
    },
  });

  const messages = useQuery({
    queryKey: ["messages", id],
    enabled: !!me,
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("*, profiles!messages_sender_id_fkey(*), message_deletes(user_id), message_views(user_id)")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true })
        .limit(300);
      if (error) throw error;
      const mine = me!.id;
      const rows = (data ?? []) as unknown as Message[];
      const visible = rows.filter((r) => {
        if (r.message_deletes?.some((d) => d.user_id === mine)) return false;
        // The database already hides an opened one-view message for non-premium
        // viewers; this is just a client-side safety net.
        if (r.one_view && !premium && r.sender_id !== mine && r.message_views?.some((v) => v.user_id === mine)) return false;
        return true;
      });
      return Promise.all(visible.map(async (r) => ({ ...r, body: await decryptStoredText(id, mine, r.body) })));
    },
  });

  // realtime: decrypt and append new messages directly for instant delivery
  useEffect(() => {
    const channel = supabase
      .channel(`messages-${id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` },
        async (payload) => {
          const row = payload.new as {
            id: string;
            conversation_id: string;
            sender_id: string;
            body: string | null;
            kind: Message["kind"];
            media_url: string | null;
            file_name: string | null;
            duration_seconds: number | null;
            one_view: boolean;
            deleted_for_everyone: boolean;
            created_at: string;
          };
          qc.invalidateQueries({ queryKey: ["conversations"] });
          if (!me) return;
          const current = qc.getQueryData<Message[]>(["messages", id]) ?? [];
          if (current.some((m) => m.id === row.id)) return;
          const convCache = qc.getQueryData<Conversation | null>(["conversation", id]);
          const profile =
            convCache?.conversation_members?.find((m) => m.user_id === row.sender_id)?.profiles ?? {
              id: row.sender_id,
              username: "?",
              display_name: "Member",
              bio: "",
              avatar_url: null,
              banner_url: null,
              created_at: row.created_at,
            };
          const body = await decryptStoredText(id, me.id, row.body);
          qc.setQueryData<Message[]>(["messages", id], [
            ...current,
            { ...row, body, profiles: profile, message_deletes: [], message_views: [] },
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` },
        (payload) => {
          const row = payload.new as { id: string; deleted_for_everyone: boolean; one_view: boolean };
          // Delete-for-everyone arrives as an UPDATE — patch it in immediately,
          // then refetch so message_views/message_deletes stay accurate.
          qc.setQueryData<Message[]>(["messages", id], (cur) =>
            (cur ?? []).map((m) =>
              m.id === row.id ? { ...m, deleted_for_everyone: row.deleted_for_everyone, one_view: row.one_view } : m,
            ),
          );
          void qc.invalidateQueries({ queryKey: ["messages", id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc, me]);

  // Re-decrypt history after a live conversation-key rotation from any member.
  useEffect(() => {
    const onRotated = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId === id) void qc.invalidateQueries({ queryKey: ["messages", id] });
    };
    window.addEventListener("conv-key-rotated", onRotated);
    return () => window.removeEventListener("conv-key-rotated", onRotated);
  }, [id, qc]);

  // mark read + scroll to bottom
  useEffect(() => {
    if (!me) return;
    supabase
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", id)
      .eq("user_id", me.id);
  }, [id, me]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length]);

  const members = conv.data?.conversation_members ?? [];
  const other = members.find((m) => m.user_id !== me?.id);
  const myMember = members.find((m) => m.user_id === me?.id);
  const isDm = conv.data?.type === "dm";
  const title = isDm ? other?.profiles.display_name : conv.data?.name;
  const isChannel = conv.data?.type === "channel";
  const canPost = !isChannel || conv.data?.created_by === me?.id;

  async function send(kind: Message["kind"], body: string | null, mediaUrl: string | null, fileName: string | null, duration: number | null, oneViewFlag = oneView) {
    if (!me) return;
    const stored = body ? await encryptText(id, me.id, body) : null;
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: id,
        sender_id: me.id,
        body: stored,
        kind,
        media_url: mediaUrl,
        file_name: fileName,
        duration_seconds: duration,
        one_view: oneViewFlag,
      })
      .select("*, profiles!messages_sender_id_fkey(*), message_deletes(user_id), message_views(user_id)")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (oneViewFlag) setOneView(false);
    const row = data as unknown as Message;
    const current = qc.getQueryData<Message[]>(["messages", id]) ?? [];
    if (!current.some((m) => m.id === row.id)) {
      const decrypted = { ...row, body: await decryptStoredText(id, me.id, row.body) };
      qc.setQueryData<Message[]>(["messages", id], [...current, decrypted]);
    }
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }

  async function submitText(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    await send("text", t, null, null, null);
  }

  /** Preview chosen media on-site first; it only uploads when the user sends it. */
  function pickFile(file: File) {
    const kind: "image" | "file" = file.type.startsWith("image/") ? "image" : "file";
    setPending({ file, kind, url: URL.createObjectURL(file) });
  }

  function cancelPending() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  }

  async function sendPending() {
    if (!pending || !me) return;
    const { file, kind, url } = pending;
    setBusy(true);
    try {
      const path = await uploadFile("media", file);
      await send(kind, null, path, file.name, null, oneView);
      URL.revokeObjectURL(url);
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      recordStartRef.current = Date.now();
      rec.ondataavailable = (ev) => chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const duration = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        setBusy(true);
        try {
          const path = await uploadFile("media", file);
          await send("voice", null, path, file.name, duration);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not send voice note");
        } finally {
          setBusy(false);
        }
      };
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Microphone permission needed for voice notes");
    }
  }

  async function leave() {
    if (!me) return;
    const { error } = await supabase
      .from("conversation_members")
      .delete()
      .eq("conversation_id", id)
      .eq("user_id", me.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["conversations"] });
    navigate({ to: "/chat" });
  }

  async function toggleMute() {
    if (!me) return;
    const muted = !!myMember?.muted;
    const { error } = await supabase
      .from("conversation_members")
      .update({ muted: !muted })
      .eq("conversation_id", id)
      .eq("user_id", me.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["conversation", id] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    toast.success(muted ? "Notifications unmuted" : "Chat muted");
  }

  async function pinLast() {
    const last = messages.data?.[messages.data.length - 1];
    if (!last) {
      toast.error("Nothing to pin yet");
      return;
    }
    const body =
      last.kind === "text"
        ? last.body
        : last.kind === "image"
          ? "📷 Photo"
          : last.kind === "voice"
            ? "🎤 Voice note"
            : `📎 ${last.file_name ?? "File"}`;
    const { error } = await supabase
      .from("conversations")
      .update({ pinned_body: body, pinned_at: last.created_at })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["conversation", id] });
    toast.success("Announcement pinned");
  }

  async function deleteForMe(messageId: string) {
    if (!me) return;
    const { error } = await supabase.from("message_deletes").insert({ message_id: messageId, user_id: me.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.setQueryData<Message[]>(["messages", id], (cur) => (cur ?? []).filter((m) => m.id !== messageId));
  }

  async function deleteForEveryone(messageId: string) {
    const { error } = await supabase.from("messages").update({ deleted_for_everyone: true }).eq("id", messageId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.setQueryData<Message[]>(["messages", id], (cur) =>
      (cur ?? []).map((m) => (m.id === messageId ? { ...m, deleted_for_everyone: true } : m)),
    );
    toast.success("Message deleted for everyone");
  }

  const lastMessage = messages.data?.[messages.data.length - 1];

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-3xl flex-col lg:h-dvh">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => navigate({ to: "/chat" })}
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {isDm && other ? (
          <UserAvatar profile={other.profiles} showOnline />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-gold">
            {isChannel ? <Pin className="h-5 w-5" /> : <Users className="h-5 w-5" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{title ?? "Loading…"}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {myMember?.muted && <BellOff className="mr-1 inline h-3 w-3" />}
            {isDm
              ? other
                ? `${members.length} member · ${timeAgo(other.profiles.created_at)} joined · encrypted`
                : "encrypted"
              : `${members.length} ${members.length === 1 ? "member" : "members"}${isChannel ? " · broadcast channel · encrypted" : " · group · encrypted"}`}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Voice call" onClick={() => call.start(false)}>
          <Phone className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Video call" onClick={() => call.start(true)}>
          <Video className="h-5 w-5" />
        </Button>
        <CallOverlay call={call} title={title ?? "Call"} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Options">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={toggleMute}>
              {myMember?.muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              {myMember?.muted ? "Unmute notifications" : "Mute notifications"}
            </DropdownMenuItem>
            {isChannel && conv.data?.created_by === me?.id && (
              <DropdownMenuItem onClick={pinLast}>
                <Pin className="h-4 w-4" /> Pin latest message
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={leave}
            >
              <LogOut className="h-4 w-4" /> Leave
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* pinned announcement */}
      {isChannel && conv.data?.pinned_body && (
        <div className="flex items-start gap-2 border-b border-border bg-accent px-4 py-2 text-sm text-accent-foreground">
          <Pin className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block font-semibold">Pinned announcement</span>
            <span className="block truncate">{conv.data.pinned_body}</span>
          </span>
        </div>
      )}

      {/* messages */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.isLoading && <p className="text-sm text-muted-foreground">Loading messages…</p>}
        {messages.data?.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No messages yet — say hello 👋
          </p>
        )}
        {messages.data?.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.sender_id === me?.id}
            meId={me?.id ?? ""}
            premium={premium}
            onDeleteForMe={deleteForMe}
            onDeleteForEveryone={deleteForEveryone}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <form onSubmit={submitText} className="border-t border-border p-3">
        {pending && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-card p-2">
            {pending.kind === "image" ? (
              <img src={pending.url} alt="Attachment preview" className="h-20 w-20 rounded-lg object-cover" />
            ) : pending.file.type.startsWith("video/") ? (
              <video src={pending.url} className="h-20 w-20 rounded-lg object-cover" muted playsInline />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-lg bg-secondary">
                <FileText className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{pending.file.name}</p>
              <Button
                type="button"
                size="sm"
                variant={oneView ? "default" : "secondary"}
                aria-pressed={oneView}
                aria-label="Toggle one view for this attachment"
                className="mt-1.5"
                onClick={() => setOneView((v) => !v)}
              >
                <Eye className="mr-1.5 h-4 w-4" /> {oneView ? "One view: on" : "One view: off"}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <Button type="button" size="sm" disabled={busy} onClick={sendPending} aria-label="Send attachment">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={cancelPending} aria-label="Cancel attachment">
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
        {canPost ? (
          <>
            <input type="file" accept="image/*,video/*" className="hidden" id={`img-${id}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
            <input type="file" className="hidden" id={`file-${id}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
            <Button type="button" variant="ghost" size="icon" asChild>
              <label htmlFor={`img-${id}`} aria-label="Send image" className="cursor-pointer">
                <ImageIcon className="h-5 w-5" />
              </label>
            </Button>
            <Button type="button" variant="ghost" size="icon" asChild>
              <label htmlFor={`file-${id}`} aria-label="Send file" className="cursor-pointer">
                <Paperclip className="h-5 w-5" />
              </label>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleRecording}
              aria-label={recording ? "Stop recording" : "Record voice note"}
              className={cn(recording && "text-destructive")}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-pressed={oneView}
              aria-label="One view: next message can be seen only once"
              title="One view — next message disappears after the recipient opens it once"
              onClick={() => setOneView((v) => !v)}
              className={cn(oneView && "text-gold")}
            >
              <Eye className="h-5 w-5" />
            </Button>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={oneView ? "One-view message — type and send" : recording ? "Recording voice note…" : "Type a message"}
            />
            <Button type="submit" size="icon" disabled={!text.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <p className="w-full py-2 text-center text-sm text-muted-foreground">
            Only channel admins can broadcast here — this feed is read-only for subscribers.
          </p>
        )}
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  meId,
  premium,
  onDeleteForMe,
  onDeleteForEveryone,
}: {
  message: Message;
  mine: boolean;
  meId: string;
  premium: boolean;
  onDeleteForMe: (id: string) => void;
  onDeleteForEveryone: (id: string) => void;
}) {
  const { data: mediaSrc } = useMediaSrc(message.media_url ? "media" : null, message.media_url);
  const [opened, setOpened] = useState(false);
  const viewedByMe = message.message_views?.some((v) => v.user_id === meId) ?? false;
  const viewed = viewedByMe || opened;
  const tombstone = message.deleted_for_everyone && !premium;
  const expired = !mine && message.one_view && viewedByMe && !premium;
  const locked = !mine && message.one_view && !viewed;

  async function openOneView() {
    setOpened(true);
    if (!meId) return;
    const views = await supabase.from("message_views").insert({ message_id: message.id, user_id: meId });
    if (views.error) toast.error(views.error.message);
    if (!premium) {
      // view-once: gone for non-premium viewers after a single look
      const del = await supabase.from("message_deletes").insert({ message_id: message.id, user_id: meId });
      if (del.error) toast.error(del.error.message);
    }
  }

  const label = message.one_view ? "One view" : null;

  return (
    <div className={cn("group flex items-end gap-1", mine ? "justify-end" : "justify-start")}>
      {!mine && <UserAvatar profile={message.profiles} size="sm" />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 self-center opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Message options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={mine ? "end" : "start"}>
          <DropdownMenuItem onClick={() => onDeleteForMe(message.id)}>
            <Trash2 className="h-4 w-4" /> Delete for me
          </DropdownMenuItem>
          {mine && !message.deleted_for_everyone && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDeleteForEveryone(message.id)}
            >
              <Trash2 className="h-4 w-4" /> Delete for everyone
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
          mine
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border border-border bg-card",
        )}
      >
        {!mine && !tombstone && (
          <div className="mb-0.5 text-xs font-semibold text-gold">{message.profiles.display_name}</div>
        )}
        {tombstone ? (
          <p className="flex items-center gap-1.5 italic opacity-80">
            <Trash2 className="h-4 w-4" /> This message was deleted
          </p>
        ) : expired ? (
          <p className="flex items-center gap-1.5 italic opacity-80">
            <Eye className="h-4 w-4" /> One-view message expired
          </p>
        ) : locked ? (
          <button
            onClick={openOneView}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5"
            aria-label="Open one-view message"
          >
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", mine ? "bg-primary-foreground/20" : "bg-secondary")}>
              <Eye className="h-4 w-4" />
            </span>
            <span>
              <span className="block font-medium">{message.kind === "text" ? "Hidden message" : "Tap to view once"}</span>
              <span className="block text-[11px] opacity-70">Disappears after one look</span>
            </span>
          </button>
        ) : (
          <>
            {message.kind === "text" && <p className="whitespace-pre-wrap break-words">{message.body ?? "(encrypted message)"}</p>}
            {message.kind === "image" &&
              (mediaSrc ? (
                <span className="relative block">
                  <a href={mediaSrc} target="_blank" rel="noreferrer">
                    <img src={mediaSrc} alt="Shared image" className="max-h-72 rounded-xl object-cover" />
                  </a>
                  {premium && message.one_view && (
                    <a
                      href={mediaSrc}
                      download={message.file_name ?? "photo"}
                      className="absolute bottom-2 right-2 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
                      aria-label="Save one-view photo"
                      title="Save photo (Premium)"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                </span>
              ) : (
                <div className="h-40 w-56 animate-pulse rounded-xl bg-muted" />
              ))}
            {message.kind === "voice" && mediaSrc && (
              <div className="relative flex items-center gap-2 py-1">
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", mine ? "bg-primary-foreground/20" : "bg-secondary")}>
                  <Play className="h-4 w-4" />
                </span>
                <div>
                  <audio controls src={mediaSrc} className="h-8 max-w-[220px]" preload="none" />
                  <div className="text-[11px] opacity-70">Voice note · {formatDuration(message.duration_seconds)}</div>
                </div>
                {premium && message.one_view && (
                  <a
                    href={mediaSrc}
                    download={message.file_name ?? "voice-note"}
                    className="absolute top-0 right-0 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
                    aria-label="Save one-view voice note"
                    title="Save voice note (Premium)"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
            {message.kind === "file" && mediaSrc && /\.(mp4|webm|mov|m4v)$/i.test(message.file_name ?? "") ? (
              <span className="relative block">
                <video src={mediaSrc} controls preload="metadata" className="max-h-72 rounded-xl" />
                {premium && message.one_view && (
                  <a
                    href={mediaSrc}
                    download={message.file_name ?? "video"}
                    className="absolute bottom-2 right-2 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
                    aria-label="Save one-view video"
                    title="Save video (Premium)"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
              </span>
            ) : message.kind === "file" && (
              <a
                href={mediaSrc ?? "#"}
                download={!message.one_view || premium ? message.file_name ?? undefined : undefined}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "flex items-center gap-2 rounded-xl px-2 py-1.5",
                  mine ? "bg-primary-foreground/15" : "bg-secondary",
                )}
              >
                <FileText className="h-5 w-5" />
                <span className="max-w-[180px] truncate underline">
                  {message.one_view && !premium ? message.file_name ?? "View file" : message.file_name ?? "Download file"}
                </span>
                {(!message.one_view || premium) && <Download className="h-4 w-4" />}
              </a>
            )}
            {message.deleted_for_everyone && premium && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] italic opacity-75">
                <Trash2 className="h-3 w-3" /> Deleted for everyone · kept visible for you (Premium)
              </div>
            )}
            {message.one_view && (
              <div className={cn("mt-0.5 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                {label}
                {mine
                  ? message.message_views?.length
                    ? " · opened ✓"
                    : " · not opened yet"
                  : premium
                    ? " · kept for you (Premium)"
                    : viewed
                      ? " · opened — disappears when you leave"
                      : ""}
              </div>
            )}
          </>
        )}
        <div className={cn("mt-0.5 text-right text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {formatClockTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}
