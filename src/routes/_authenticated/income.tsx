import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleDashed, Copy, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { batchFor, CREDITS_PER_BATCH, CREDIT_TASKS, taskDone } from "@/lib/credits";
import { pageHead } from "@/lib/page-head";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/income")({
  head: () => pageHead("Credits", "Earn credits on SA Connect — tasks, batches and referrals."),
  component: Income,
});

interface CreditEvent {
  id: string;
  user_id: string;
  amount: number;
  reason: string;
  created_at: string;
}

function Income() {
  const { data: me } = useCurrentProfile();
  const [copied, setCopied] = useState(false);

  const events = useQuery({
    queryKey: ["credit-events", me?.id],
    enabled: !!me,
    queryFn: async (): Promise<CreditEvent[]> => {
      const { data, error } = await supabase
        .from("credit_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as CreditEvent[];
    },
  });

  const progress = useQuery({
    queryKey: ["credit-progress", me?.id],
    enabled: !!me,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from("credit_progress")
        .select("messages_sent")
        .eq("user_id", me!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.messages_sent ?? 0;
    },
  });

  const invited = useQuery({
    queryKey: ["referrals-count", me?.id],
    enabled: !!me,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("referrals")
        .select("referred_id", { count: "exact", head: true })
        .eq("referrer_id", me!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const rows = events.data ?? [];
  const total = useMemo(() => rows.reduce((sum, e) => sum + e.amount, 0), [rows]);
  const reasons = useMemo(() => new Set(rows.map((e) => e.reason)), [rows]);
  const batch = batchFor(total);
  const messageBonusCount = rows.filter((e) => e.reason === "messages_10").length;
  const referralCount = rows.filter((e) => e.reason.startsWith("referral:")).length;

  const inviteLink = me?.referral_code
    ? `${window.location.origin}/auth?ref=${me.referral_code}`
    : null;

  async function copyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — long-press to copy: " + inviteLink);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-8">
      <header>
        <p className="mb-2 text-xs uppercase text-primary">SA Connect</p>
        <h1 className="font-display text-3xl font-bold">Credits</h1>
        <p className="mt-2 text-muted-foreground">
          Earn credits by being active — every {CREDITS_PER_BATCH} credits unlock a new batch badge.
        </p>
      </header>

      {/* balance + batch */}
      <section className="rounded-md border border-glass-border glass p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total credits earned</p>
            <p className="font-display text-4xl font-bold text-gold">{total}</p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1.5 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-gold" /> Current batch
            </p>
            <p className="font-display text-2xl font-bold">{batch.name}</p>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Progress value={(batch.progress / CREDITS_PER_BATCH) * 100} aria-label="Progress to next batch" />
          <p className="text-xs text-muted-foreground">
            {batch.progress} / {CREDITS_PER_BATCH} — {batch.toNext} more credits for the next batch
          </p>
        </div>
      </section>

      {/* tasks */}
      <section className="rounded-md border border-glass-border glass p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <TrendingUp className="h-5 w-5 text-gold" /> Ways to earn
        </h2>
        <ul className="mt-4 divide-y divide-border">
          {CREDIT_TASKS.map((t) => {
            const done = taskDone(reasons, t.reason);
            const count =
              t.reason === "messages_10" ? messageBonusCount : t.reason === "referral" ? referralCount : done ? 1 : 0;
            return (
              <li key={t.reason} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  {count > 0 ? (
                    <Check className="h-4 w-4 shrink-0 text-gold" />
                  ) : (
                    <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm">{t.label}</span>
                    {t.repeatable && count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {count}× earned{t.reason === "messages_10" ? ` · ${progress.data ?? 0} messages sent so far` : ""}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-gold">+{t.amount}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* referrals */}
      <section className="rounded-md border border-glass-border glass p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <Users className="h-5 w-5 text-gold" /> Invite friends
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every friend who joins with your code earns you <b className="text-gold">+10 credits</b>. You have invited{" "}
          <b>{invited.data ?? 0}</b> {invited.data === 1 ? "friend" : "friends"} so far.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="rounded-md border border-border bg-secondary px-3 py-2 font-mono text-sm tracking-widest">
            {me?.referral_code ?? "…"}
          </code>
          <Button variant="secondary" onClick={copyInvite} disabled={!inviteLink}>
            <Copy className="mr-2 h-4 w-4" /> {copied ? "Copied!" : "Copy invite link"}
          </Button>
        </div>
      </section>

      {/* recent activity */}
      <section className="rounded-md border border-glass-border glass p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wallet className="h-5 w-5 text-gold" /> Recent activity
        </h2>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No credits yet — complete a task above to start.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {rows.slice(0, 12).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">{labelFor(e.reason)}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</span>
                  <span className="font-semibold text-gold">+{e.amount}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Creator income (earnings in cash) is coming soon — credits and batches are live today.
      </p>
    </div>
  );
}

function labelFor(reason: string): string {
  if (reason.startsWith("referral:")) return "A friend joined with your code";
  const task = CREDIT_TASKS.find((t) => t.reason === reason);
  return task?.label ?? reason;
}
