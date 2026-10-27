import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { playMessageSound } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Notification } from "@/lib/types";

function useRealtimeNotifications(meId: string | undefined, qc: ReturnType<typeof useQueryClient>) {
  useEffect(() => {
    if (!meId) return;
    const channel = supabase
      .channel(`notifications-${meId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${meId}` },
        () => {
          playMessageSound();
          void qc.invalidateQueries({ queryKey: ["notifications", meId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId, qc]);
}

export function useNotifications(meId: string | undefined) {
  const qc = useQueryClient();
  useRealtimeNotifications(meId, qc);
  return useQuery({
    queryKey: ["notifications", meId],
    enabled: !!meId,
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("user_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
    refetchInterval: 60_000,
  });
}

export function NotificationBell({ meId }: { meId: string | undefined }) {
  const { data } = useNotifications(meId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const items = data ?? [];
  const unread = items.filter((n) => !n.read).length;

  async function markAll() {
    if (!meId) return;
    await supabase.from("user_notifications").update({ read: true }).eq("user_id", meId).eq("read", false);
    void qc.invalidateQueries({ queryKey: ["notifications", meId] });
  }

  if (!meId) return null;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button onClick={markAll} className="text-xs text-muted-foreground hover:text-foreground">
              Mark all read
            </button>
          )}
        </div>
        {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>}
        {items.map((n) => (
          <div key={n.id} className={cn("rounded-md px-2 py-2 text-sm", !n.read && "bg-accent/60")}>
            <p className="font-medium leading-tight">{n.title}</p>
            {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
            <p className="mt-1 text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
