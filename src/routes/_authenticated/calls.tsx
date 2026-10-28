import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Phone, Video, VideoOff, PhoneOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { useCallEngine } from "@/lib/call-engine";
import { formatClockTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { EmptyState } from "@/components/empty-state";
import type { CallLog } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({
    meta: [
      { title: "Calls — SA Connect" },
      { name: "description", content: "Your voice and video call history on SA Connect." },
      { property: "og:title", content: "Calls — SA Connect" },
      { property: "og:description", content: "Your voice and video call history on SA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CallsPage,
});

const STATUS_LABEL: Record<CallLog["status"], string> = {
  ringing: "Ringing…",
  answered: "Answered",
  missed: "Missed",
  declined: "Declined",
  cancelled: "Cancelled",
};

function CallsPage() {
  const { data: me } = useCurrentProfile();
  const call = useCallEngine();

  const log = useQuery({
    queryKey: ["call-log", me?.id],
    enabled: !!me,
    queryFn: async (): Promise<CallLog[]> => {
      const { data, error } = await supabase
        .from("call_log")
        .select("*, caller:profiles!call_log_caller_id_fkey(*), callee:profiles!call_log_callee_id_fkey(*)")
        .or(`caller_id.eq.${me!.id},callee_id.eq.${me!.id}`)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as CallLog[];
    },
  });

  const rows = (log.data ?? []).filter((r) => r.caller?.id && r.callee?.id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold">Calls</h1>
        <p className="text-sm text-muted-foreground">Voice and video calls, WhatsApp style.</p>
      </header>
      {rows.length === 0 ? (
        <EmptyState icon={Phone} title="No calls yet" hint="Start a voice or video call from any chat." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const outgoing = r.caller_id === me?.id;
            const other = outgoing ? r.callee : r.caller;
            const missedish = r.status === "missed" || (r.status === "declined" && outgoing);
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-border glass px-3 py-2.5",
                  missedish && "border-destructive/30",
                )}
              >
                <UserAvatar profile={other} size="md" showOnline />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-medium", missedish && "text-destructive")}>{other.display_name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {outgoing ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                    {r.kind === "video" ? "Video" : "Voice"} · {STATUS_LABEL[r.status]}
                    {r.status === "answered" && r.duration_seconds > 0 && ` · ${formatDuration(r.duration_seconds)}`}
                    {" · "}
                    {formatClockTime(r.created_at)}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Voice call ${other.display_name}`}
                  disabled={call.status !== "idle"}
                  onClick={() => call.start(r.conversation_id, other.id, other.display_name, false)}
                >
                  <Phone className="h-4.5 w-4.5 text-gold" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Video call ${other.display_name}`}
                  disabled={call.status !== "idle"}
                  onClick={() => call.start(r.conversation_id, other.id, other.display_name, true)}
                >
                  <Video className="h-4.5 w-4.5 text-gold" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {call.status !== "idle" && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          {call.kind === "video" ? <VideoOff className="h-4 w-4" /> : <PhoneOff className="h-4 w-4" />}
          A call is in progress — end it before starting a new one.
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
