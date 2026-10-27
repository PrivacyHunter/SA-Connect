import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type ChatActivity = "idle" | "typing" | "recording";

/** Live per-conversation typing / voice-recording presence. */
export function useChatActivity(conversationId: string, meId: string | undefined, enabled = true) {
  const [others, setOthers] = useState<Record<string, ChatActivity>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const currentRef = useRef<ChatActivity>("idle");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!meId || !enabled) return;
    const ch = supabase.channel(`chat-activity-${conversationId}`, { config: { presence: { key: meId } } });
    channelRef.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ activity: ChatActivity }>();
      const next: Record<string, ChatActivity> = {};
      for (const [uid, metas] of Object.entries(state)) {
        if (uid === meId) continue;
        const a = metas[metas.length - 1]?.activity ?? "idle";
        if (a !== "idle") next[uid] = a;
      }
      setOthers(next);
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") void ch.track({ activity: currentRef.current });
    });
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      channelRef.current = null;
      setOthers({});
      supabase.removeChannel(ch);
    };
  }, [conversationId, meId, enabled]);

  const setActivity = useCallback((a: ChatActivity) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (a === "typing") idleTimer.current = setTimeout(() => setActivity("idle"), 3000);
    if (currentRef.current === a) return;
    currentRef.current = a;
    void channelRef.current?.track({ activity: a });
  }, []);

  return { others, setActivity };
}
