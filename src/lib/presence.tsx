import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const OnlineContext = createContext<Set<string>>(new Set());

/** Shared realtime presence room: every signed-in client broadcasts its user id. */
export function OnlineProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel("presence-online", {
      config: { presence: { key: userId } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    // Last seen: refresh while active and when the tab is hidden/closed.
    const touch = () => void supabase.rpc("touch_last_seen");
    touch();
    const beat = setInterval(touch, 60_000);
    const onVis = () => document.visibilityState === "hidden" && touch();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
      touch();
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>;
}

export const useOnlineUsers = () => useContext(OnlineContext);

export function useIsOnline(userId: string | null | undefined): boolean {
  const online = useOnlineUsers();
  return !!userId && online.has(userId);
}
