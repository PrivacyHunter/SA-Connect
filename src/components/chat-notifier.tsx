import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { decryptStoredText, ensureMyKeys } from "@/lib/e2ee";
import { ensureNotificationPermission, playMessageSound, showNotification } from "@/lib/notify";
import type { Conversation } from "@/lib/types";

/** Global listener: ring + notify for new messages outside the open chat. */
export function ChatNotifier({ meId }: { meId: string | undefined }) {
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!meId) return;
    void ensureMyKeys(meId);
    void ensureNotificationPermission();
    const channel = supabase
      .channel(`notify-${meId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as {
          id: string;
          conversation_id: string;
          sender_id: string;
          kind: string;
          body: string | null;
        };
        qc.invalidateQueries({ queryKey: ["conversations"] });
        if (m.sender_id === meId) return;
        const convs = qc.getQueryData<Conversation[]>(["conversations"]);
        const conv = convs?.find((c) => c.id === m.conversation_id);
        if (!conv) return; // not one of my conversations
        if (pathname.startsWith(`/chat/${m.conversation_id}`)) return;
        if (conv.conversation_members.some((mm) => mm.user_id === meId && mm.muted)) return;
        const other = conv.conversation_members.find((mm) => mm.user_id !== meId)?.profiles;
        const title =
          conv.type === "dm"
            ? (other?.display_name ?? "New message")
            : `${conv.name ?? "Group"} · ${other?.display_name ?? "New message"}`;
        const preview =
          m.kind === "text"
            ? decryptStoredText(m.conversation_id, meId, m.body)
            : Promise.resolve(null);
        void preview.then((body) => {
          const text =
            body ??
            ({ image: "📷 Photo", voice: "🎤 Voice note", file: "📎 File" } as Record<string, string>)[m.kind] ??
            "New message";
          playMessageSound();
          showNotification(title, text);
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId, pathname, qc]);

  return null;
}
