import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Mic,
  MoreHorizontal,
  Palette,
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
import { decryptStoredText, encryptText, getKeyState, migrateConversationHistory, shareConversationKey, unlockWithPassword } from "@/lib/e2ee";
import { oneViewReopenable, tickState, type TickState } from "@/lib/chat-rules";
import { formatClockTime, formatDuration, formatLastSeen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationMember, Message } from "@/lib/types";
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
import { useCallEngine } from "@/lib/call-engine";
import { Ban, Eraser, Flag, Phone, ShieldAlert, Video } from "lucide-react";
import { useIsOnline } from "@/lib/presence";
import { useChatActivity } from "@/hooks/use-chat-activity";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type Wallpaper = { kind: "preset"; id: string } | { kind: "image"; path: string };

const WALLPAPER_PRESETS: { id: string; label: string; style: CSSProperties }[] = [
  {
    id: "dots",
    label: "Dots",
    style: {
      backgroundImage: "radial-gradient(hsl(var(--muted-foreground) / 0.18) 1px, transparent 1px)",
      backgroundSize: "22px 22px",
    },
  },
  {
    id: "grid",
    label: "Grid",
    style: {
      backgroundImage:
        "linear-gradient(hsl(var(--muted-foreground) / 0.08) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--muted-foreground) / 0.08) 1px, transparent 1px)",
      backgroundSize: "26px 26px",
    },
  },
  {
    id: "glow",
    label: "Soft glow",
    style: {
      backgroundImage:
        "linear-gradient(160deg, hsl(var(--accent) / 0.6), transparent 55%), linear-gradient(20deg, hsl(var(--secondary) / 0.7), transparent 50%)",
    },
  },
  {
    id: "dusk",
    label: "Dusk",
    style: { backgroundImage: "linear-gradient(180deg, hsl(var(--gold) / 0.14), transparent 45%, hsl(var(--accent) / 0.45))" },
  },
];

function TypingDots() {
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function RecordingBars() {
  return (
    <span className="inline-flex h-3 items-center gap-0.5" aria-hidden>
      {[0, 120, 240, 360].map((d) => (
        <span key={d} className="h-full w-0.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${d}ms`, animationDuration: "0.7s" }} />
      ))}
    </span>
  );
}

export const Route = createFileRoute("/_authenticated/chat/$id")({
  validateSearch: (search: { [key: string]: unknown }): { call?: "voice" | "video" } => {
    const value = search["call"];
    return value === "video" || value === "voice" ? { call: value } : {};
  },
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
  const [confirm, setConfirm] = useState<"clear" | "block" | null>(null);
  const [reportMode, setReportMode] = useState<"report" | "block" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [oneView, setOneView] = useState(false);
  const [pending, setPending] = useState<{ file: File; kind: "image" | "file"; url: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const call = useCallEngine();
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [wallpaper, setWallpaper] = useState<Wallpaper | null>(null);

  // Wallpaper is a per-device preference, kept in localStorage per conversation.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`chat-wallpaper:${id}`);
      if (raw) setWallpaper(JSON.parse(raw) as Wallpaper);
    } catch {
      /* ignore corrupt value */
    }
  }, [id]);

  const customWallpaperPath = wallpaper?.kind === "image" ? wallpaper.path : null;
  const { data: wallpaperSrc } = useMediaSrc(customWallpaperPath ? "media" : null, customWallpaperPath);
  const messagesStyle: CSSProperties =
    wallpaper?.kind === "image" && wallpaperSrc
      ? { backgroundImage: `url(${wallpaperSrc})`, backgroundSize: "cover", backgroundPosition: "center" }
      : wallpaper?.kind === "preset"
        ? (WALLPAPER_PRESETS.find((w) => w.id === wallpaper.id)?.style ?? {})
        : {};

  function chooseWallpaper(w: Wallpaper | null) {
    setWallpaper(w);
    try {
      if (w) localStorage.setItem(`chat-wallpaper:${id}`, JSON.stringify(w));
      else localStorage.removeItem(`chat-wallpaper:${id}`);
    } catch {
      /* storage full/blocked — wallpaper just won't persist */
    }
  }

  async function uploadWallpaper(file: File) {
    try {
      const path = await uploadFile("media", file);
      chooseWallpaper({ kind: "image", path });
      toast.success("Wallpaper set");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload wallpaper");
    }
  }


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
        .select("*, profiles!messages_sender_id_fkey(*), message_deletes(user_id), message_views(user_id), message_deliveries(user_id)")
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
      void markDelivered(visible);
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
            { ...row, body, profiles: profile, message_deletes: [], message_views: [], message_deliveries: [] },
          ]);
          // receipts: this device received the message, and an open chat means it was seen
          void markDelivered([row as unknown as Message]);
          void supabase
            .from("conversation_members")
            .update({ last_read_at: new Date().toISOString() })
            .eq("conversation_id", id)
            .eq("user_id", me.id);
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_deliveries" },
        (payload) => {
          const row = payload.new as { message_id: string; user_id: string };
          qc.setQueryData<Message[]>(["messages", id], (cur) =>
            (cur ?? []).map((m) =>
              m.id === row.message_id && !(m.message_deliveries ?? []).some((d) => d.user_id === row.user_id)
                ? { ...m, message_deliveries: [...(m.message_deliveries ?? []), { user_id: row.user_id }] }
                : m,
            ),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${id}` },
        () => {
          // last_read_at moves when the other side reads — refreshes the seen ticks
          void qc.invalidateQueries({ queryKey: ["conversation", id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc, me]);

  // Keys: a device whose key does not match the account (new device or an
  // old divergent key) must unlock with the password before it can read.
  const [keysLocked, setKeysLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  // Repair on open, after a rotation, and after unlocking: re-share the key
  // with any member who cannot open it, re-encrypt history this device can
  // still read into it, then re-decrypt the list.
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    const repair = async () => {
      const state = await getKeyState(me.id);
      if (cancelled) return;
      setKeysLocked(state === "locked");
      if (state !== "ready") return;
      const shared = await shareConversationKey(id, me.id);
      const migrated = await migrateConversationHistory(id, me.id);
      if (!cancelled && (shared || migrated > 0)) void qc.invalidateQueries({ queryKey: ["messages", id] });
    };
    void repair();
    const onRotated = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId !== id) return;
      void qc.invalidateQueries({ queryKey: ["messages", id] });
      void repair();
    };
    const onUnlocked = () => {
      void qc.invalidateQueries({ queryKey: ["messages", id] });
      void repair();
    };
    window.addEventListener("conv-key-rotated", onRotated);
    window.addEventListener("e2ee-unlocked", onUnlocked);
    return () => {
      cancelled = true;
      window.removeEventListener("conv-key-rotated", onRotated);
      window.removeEventListener("e2ee-unlocked", onUnlocked);
    };
  }, [id, qc, me]);

  async function unlockKeys(e: FormEvent) {
    e.preventDefault();
    if (!me || !unlockPassword) return;
    setUnlocking(true);
    try {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email;
      if (!email) {
        toast.error("Sign in with your email and password to unlock your messages");
        return;
      }
      const result = await unlockWithPassword(me.id, email, unlockPassword);
      if (result === "wrong-password") toast.error("That password is not correct");
      else if (result === "failed") toast.error("Could not unlock messages — please try again");
      else {
        setUnlockPassword("");
        setKeysLocked(false);
        toast.success("Messages unlocked on this device");
      }
    } finally {
      setUnlocking(false);
    }
  }

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
  const otherId = isDm ? other?.user_id : undefined;
  const otherOnline = useIsOnline(otherId);

  const blockState = useQuery({
    queryKey: ["block", id, otherId],
    enabled: !!me && !!otherId,
    queryFn: async () => {
      const [{ data: mine }, { data: any }] = await Promise.all([
        supabase.from("user_blocks").select("blocked_id").eq("blocker_id", me!.id).eq("blocked_id", otherId!).maybeSingle(),
        supabase.rpc("chat_is_blocked", { p_conversation: id }),
      ]);
      return { iBlocked: !!mine, blocked: !!any };
    },
  });
  const iBlocked = !!blockState.data?.iBlocked;
  const chatBlocked = !!blockState.data?.blocked;
  const { others: activity, setActivity } = useChatActivity(id, me?.id, !chatBlocked);
  const activeEntries = Object.entries(activity);
  const activityKind = activeEntries.some(([, a]) => a === "recording") ? "recording" : activeEntries.length ? "typing" : null;
  const activityNames = activeEntries
    .filter(([, a]) => a === activityKind)
    .map(([uid]) => members.find((m) => m.user_id === uid)?.profiles.display_name ?? "Someone");
  const activityLabel = !activityKind
    ? null
    : `${isDm ? "" : activityNames.join(", ") + " "}${activityKind === "recording" ? "recording voice…" : "typing…"}`.trim();

  // Auto-start a call when the chat is opened from the Calls page (?call=voice|video).
  const autoCall = Route.useSearch({ select: (s) => s.call });
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoCall || autoStartedRef.current || !me || !isDm || !other || chatBlocked) return;
    if (call.status !== "idle") return;
    autoStartedRef.current = true;
    void call.start(id, other.user_id, other.profiles.display_name, autoCall === "video");
    void navigate({ to: "/chat/$id", params: { id }, search: {}, replace: true });
  }, [autoCall, me, isDm, other, chatBlocked, call, id, navigate]);

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
      .select("*, profiles!messages_sender_id_fkey(*), message_deletes(user_id), message_views(user_id), message_deliveries(user_id)")
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

  /** Receipt: tells senders their message reached this device (drives the double tick). */
  async function markDelivered(rows: Pick<Message, "id" | "sender_id">[]) {
    if (!me) return;
    const incoming = rows.filter((r) => r.sender_id !== me.id);
    if (!incoming.length) return;
    await supabase
      .from("message_deliveries")
      .upsert(incoming.map((r) => ({ message_id: r.id, user_id: me.id })), {
        onConflict: "message_id,user_id",
        ignoreDuplicates: true,
      });
  }

  async function submitText(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    setActivity("idle");
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
        setActivity("idle");
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
      setActivity("recording");
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

  async function clearChat() {
    const { error } = await supabase.rpc("clear_chat", { p_conversation: id });
    setConfirm(null);
    if (error) return void toast.error(error.message);
    qc.setQueryData<Message[]>(["messages", id], []);
    toast.success("Chat cleared from your side");
  }

  async function block() {
    if (!me || !other) return;
    const { error } = await supabase.from("user_blocks").insert({ blocker_id: me.id, blocked_id: other.user_id });
    setConfirm(null);
    if (error && error.code !== "23505") return void toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["block", id] });
    toast.success(`${other.profiles.display_name} blocked`);
  }

  async function unblock() {
    if (!me || !other) return;
    if (!premium) return void navigate({ to: "/premium" });
    const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", me.id).eq("blocked_id", other.user_id);
    if (error) return void toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["block", id] });
    toast.success(`${other.profiles.display_name} unblocked`);
  }

  async function submitReport() {
    if (!me || !other) return;
    const { error } = await supabase
      .from("user_reports")
      .insert({ reporter_id: me.id, reported_id: other.user_id, conversation_id: id, reason: reason.trim() });
    if (error) return void toast.error(error.message);
    const alsoBlock = reportMode === "block";
    setReportMode(null);
    setReason("");
    toast.success("Report sent — thank you");
    if (alsoBlock) await block();
  }

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
          <p className={cn("flex items-center gap-1 truncate text-xs text-muted-foreground", (activityLabel || (isDm && otherOnline)) && "text-gold")}>
            {myMember?.muted && <BellOff className="inline h-3 w-3" />}
            {activityLabel ? (
              <>
                {activityKind === "recording" ? <RecordingBars /> : <TypingDots />}
                {activityLabel}
              </>
            ) : isDm ? (
              other ? (
                chatBlocked ? "encrypted" : otherOnline ? "Online" : other.profiles.last_seen_at ? `Last seen ${formatLastSeen(other.profiles.last_seen_at)}` : "Offline"
              ) : (
                "encrypted"
              )
            ) : (
              `${members.length} ${members.length === 1 ? "member" : "members"}${isChannel ? " · broadcast channel · encrypted" : " · group · encrypted"}`
            )}
          </p>
        </div>
        {isDm && other && !chatBlocked && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Voice call"
              disabled={call.status !== "idle"}
              onClick={() => call.start(id, other.user_id, other.profiles.display_name, false)}
            >
              <Phone className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Video call"
              disabled={call.status !== "idle"}
              onClick={() => call.start(id, other.user_id, other.profiles.display_name, true)}
            >
              <Video className="h-5 w-5" />
            </Button>
          </>
        )}
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
            <DropdownMenuItem onClick={() => setWallpaperOpen(true)}>
              <Palette className="h-4 w-4" /> Chat wallpaper
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirm("clear")}>
              <Eraser className="h-4 w-4" /> Clear chat
            </DropdownMenuItem>
            {isDm && other && (
              <>
                {iBlocked ? (
                  <DropdownMenuItem onClick={() => (premium ? unblock() : navigate({ to: "/premium" }))}>
                    <Ban className="h-4 w-4" /> {premium ? "Unblock" : "Unblock (Premium)"}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setConfirm("block")}>
                    <Ban className="h-4 w-4" /> Block
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setReportMode("report")}>
                  <Flag className="h-4 w-4" /> Report
                </DropdownMenuItem>
                {!iBlocked && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setReportMode("block")}>
                    <ShieldAlert className="h-4 w-4" /> Report and block
                  </DropdownMenuItem>
                )}
              </>
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

      {keysLocked && (
        <form onSubmit={unlockKeys} className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/60 px-4 py-3 text-sm">
          <span className="w-full text-foreground sm:w-auto sm:flex-1">
            Your messages are locked on this device. Enter your account password to read them.
          </span>
          <Input
            type="password"
            autoComplete="current-password"
            value={unlockPassword}
            onChange={(e) => setUnlockPassword(e.target.value)}
            placeholder="Password"
            aria-label="Account password"
            className="h-9 w-44"
          />
          <Button type="submit" size="sm" disabled={unlocking || !unlockPassword}>
            {unlocking ? "Unlocking…" : "Unlock"}
          </Button>
        </form>
      )}

      {/* messages */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" style={messagesStyle}>
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
            members={members}
            onDeleteForMe={deleteForMe}
            onDeleteForEveryone={deleteForEveryone}
          />
        ))}
        {activityLabel && (
          <div className="flex w-fit items-center gap-2 rounded-2xl bg-secondary px-3 py-2 text-xs text-secondary-foreground">
            {activityKind === "recording" ? <RecordingBars /> : <TypingDots />}
            {activityLabel}
          </div>
        )}
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
        {isDm && chatBlocked ? (
          <div className="flex w-full flex-wrap items-center justify-center gap-2 py-2 text-center text-sm text-muted-foreground">
            {iBlocked ? (
              <>
                <span>You blocked {other?.profiles.display_name}.</span>
                {premium ? (
                  <Button type="button" size="sm" variant="secondary" onClick={unblock}>
                    Unblock
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="secondary" onClick={() => navigate({ to: "/premium" })}>
                    Unblock with Premium
                  </Button>
                )}
              </>
            ) : (
              <span>You can’t send messages in this chat.</span>
            )}
          </div>
        ) : canPost ? (
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
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className={cn("h-5 w-5", recording && "animate-pulse")} />}
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
            {recording ? (
              <div className="flex h-10 flex-1 items-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive">
                <RecordingBars /> Recording voice note…
              </div>
            ) : (
              <Input
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setActivity(e.target.value ? "typing" : "idle");
                }}
                onBlur={() => setActivity("idle")}
                placeholder={oneView ? "One-view message — type and send" : "Type a message"}
              />
            )}
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

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "clear" ? "Clear this chat?" : `Block ${other?.profiles.display_name ?? "this person"}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "clear"
                ? "All messages in this chat will be removed from your side only. The other person still keeps their copy."
                : premium
                  ? "They won’t be able to message you here. You can unblock anytime."
                  : "They won’t be able to message you here. Unblocking is a Premium feature."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => (confirm === "clear" ? clearChat() : block())}>
              {confirm === "clear" ? "Clear chat" : "Block"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={reportMode !== null} onOpenChange={(o) => !o && setReportMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reportMode === "block" ? "Report and block" : "Report"} {other?.profiles.display_name}</DialogTitle>
            <DialogDescription>Tell us what happened. Our team reviews every report.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (spam, harassment, scam…)" maxLength={2000} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReportMode(null)}>Cancel</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3} onClick={submitReport}>
              {reportMode === "block" ? "Report & block" : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wallpaperOpen} onOpenChange={setWallpaperOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Chat wallpaper</DialogTitle>
            <DialogDescription>Pick a background for this chat. Only you see it, on this device.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {WALLPAPER_PRESETS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() =>
                  chooseWallpaper(wallpaper?.kind === "preset" && wallpaper.id === w.id ? null : { kind: "preset", id: w.id })
                }
                className={cn(
                  "flex h-16 items-end justify-start rounded-xl border border-border p-1.5 text-[11px] font-medium",
                  wallpaper?.kind === "preset" && wallpaper.id === w.id && "ring-2 ring-gold",
                )}
                style={w.style}
                aria-pressed={wallpaper?.kind === "preset" && wallpaper.id === w.id}
              >
                {w.label}
              </button>
            ))}
            <label className="flex h-16 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-[11px] text-muted-foreground hover:border-gold/60 hover:text-foreground">
              Upload photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadWallpaper(f);
                }}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => chooseWallpaper(null)} disabled={!wallpaper}>
              Remove wallpaper
            </Button>
            <Button onClick={() => setWallpaperOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  meId,
  premium,
  members,
  onDeleteForMe,
  onDeleteForEveryone,
}: {
  message: Message;
  mine: boolean;
  meId: string;
  premium: boolean;
  members: ConversationMember[];
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

  // WhatsApp-style receipt for my own messages: ✓ sent, ✓✓ delivered, gold ✓✓ seen
  const others = members.filter((m) => m.user_id !== meId);
  const deliveredCount = others.filter((o) => (message.message_deliveries ?? []).some((d) => d.user_id === o.user_id)).length;
  const seenCount = others.filter(
    (o) => o.last_read_at && new Date(o.last_read_at).getTime() >= new Date(message.created_at).getTime(),
  ).length;
  const receipt = tickState(others.length, deliveredCount, seenCount);

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
            className="h-7 w-7 self-center opacity-60 transition-opacity hover:opacity-100"
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
        <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {formatClockTime(message.created_at)}
          {mine && <Ticks state={receipt} />}
        </div>
      </div>
    </div>
  );
}

/** Sent / delivered / seen ticks for outgoing messages. Gold reads well in both themes. */
function Ticks({ state }: { state: TickState }) {
  if (state === "sent") return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
  return (
    <CheckCheck
      className={cn("h-3.5 w-3.5", state === "seen" && "text-gold")}
      aria-label={state === "seen" ? "Seen" : "Delivered"}
    />
  );
}
