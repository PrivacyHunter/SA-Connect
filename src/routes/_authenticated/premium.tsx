import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { usePremium } from "@/hooks/use-premium";
import { uploadFile } from "@/lib/media";
import type { PaymentRequest } from "@/lib/types";
import { siteSettingsQuery } from "@/components/site-chrome";
import { pageHead } from "@/lib/page-head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/premium")({
  head: () => pageHead("Premium", "SA Connect Premium — unlock extras for $2 per month."),
  component: PremiumPage,
});

const FEATURES = [
  "Messages deleted for everyone stay visible to you",
  "View-once photos can be opened again and saved to your device",
  "Supports the growth of SA Connect",
];

function PremiumPage() {
  const { data: me } = useCurrentProfile();
  const { premiumUntil, premium } = usePremium(me?.id);
  const qc = useQueryClient();
  const { data: settings } = useQuery(siteSettingsQuery);
  const [file, setFile] = useState<File | null>(null);
  const [trx, setTrx] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const requests = useQuery({
    queryKey: ["my-payment-requests", me?.id],
    enabled: !!me,
    queryFn: async (): Promise<PaymentRequest[]> => {
      const { data, error } = await supabase
        .from("payment_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as PaymentRequest[];
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    if (!file) {
      toast.error("Attach your payment screenshot");
      return;
    }
    if (!trx.trim()) {
      toast.error("Enter your transaction (TRX) ID");
      return;
    }
    setBusy(true);
    try {
      const path = await uploadFile("payments", file);
      const fullNote = `TRX: ${trx.trim()}${note.trim() ? ` · ${note.trim()}` : ""}`;
      const { error } = await supabase
        .from("payment_requests")
        .insert({ user_id: me.id, screenshot_path: path, note: fullNote });
      if (error) throw error;
      toast.success("Proof uploaded — access is granted after approval");
      setFile(null);
      setTrx("");
      setNote("");
      await qc.invalidateQueries({ queryKey: ["my-payment-requests", me.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit payment proof");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-8">
      <header className="text-center">
        <p className="mb-2 text-xs uppercase text-primary">SA Connect</p>
        <h1 className="font-display text-3xl font-bold">Premium</h1>
        <p className="mt-2 text-muted-foreground">Unlock extras for the whole platform — one simple plan.</p>
      </header>

      {premium && premiumUntil && (
        <div className="rounded-md border border-glass-border glass p-4 text-center">
          <p className="flex items-center justify-center gap-2 font-semibold text-gold">
            <Crown className="h-5 w-5" /> You are Premium until {new Date(premiumUntil).toLocaleDateString()}
          </p>
        </div>
      )}

      <section className="rounded-md border border-glass-border glass p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold">Monthly plan</h2>
            <p className="text-sm text-muted-foreground">Billed by you, approved by the team.</p>
          </div>
          <p className="font-display text-3xl font-bold text-gold">$2<span className="text-sm font-normal text-muted-foreground">/month</span></p>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" /> {f}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-glass-border glass p-6">
        <h2 className="font-semibold">How to pay</h2>
        {settings?.payment_info ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{settings.payment_info}</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Payment account details will be shown here. For now, ask the SA Connect team where to send $2.</p>
        )}
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Send $2 for one month of Premium.</li>
          <li>Enter your transaction (TRX) ID and upload the payment screenshot below.</li>
          <li>The team approves it and Premium is switched on for 30 days.</li>
        </ol>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor="proof">Payment screenshot</Label>
            <Input id="proof" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="trx">Transaction (TRX) ID</Label>
            <Input id="trx" required value={trx} onChange={(e) => setTrx(e.target.value)} placeholder="TRX ID from your Easypaisa / JazzCash receipt" maxLength={100} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="pnote">Reference / note (optional)</Label>
            <Input id="pnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. sender name" maxLength={200} className="mt-1.5" />
          </div>
          <Button type="submit" disabled={busy || !file || !trx.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Submit payment proof
          </Button>
        </form>
      </section>

      {requests.data && requests.data.length > 0 && (
        <section className="rounded-md border border-glass-border glass p-6">
          <h2 className="font-semibold">Your submissions</h2>
          <div className="mt-3 space-y-2 text-sm">
            {requests.data.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span>{new Date(r.created_at).toLocaleString()}{r.note ? ` · ${r.note}` : ""}</span>
                <span className={r.status === "approved" ? "font-semibold text-gold" : r.status === "rejected" ? "text-destructive" : "text-muted-foreground"}>
                  {r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : "Pending review"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
