import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { inspectUser, readConversation, saveSiteSettings } from "@/lib/moderation.functions";
import { siteSettingsQuery } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SiteSettingsForm() {
  const { data } = useQuery(siteSettingsQuery);
  if (!data) return <p className="py-8 text-muted-foreground">Loading…</p>;
  return <SettingsInner key={data.updated_at} initial={data} />;
}

function SettingsInner({ initial }: { initial: { marquee: string[]; facebook_url: string; instagram_url: string; youtube_url: string; x_url: string; payment_info: string } }) {
  const save = useServerFn(saveSiteSettings);
  const qc = useQueryClient();
  const [marquee, setMarquee] = useState(initial.marquee.join("\n"));
  const [links, setLinks] = useState({ facebook_url: initial.facebook_url, instagram_url: initial.instagram_url, youtube_url: initial.youtube_url, x_url: initial.x_url });
  const [paymentInfo, setPaymentInfo] = useState(initial.payment_info);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await save({ data: { marquee: marquee.split("\n").map((s) => s.trim()).filter(Boolean), payment_info: paymentInfo, ...links } });
      await qc.invalidateQueries({ queryKey: siteSettingsQuery.queryKey });
      toast.success("Site settings saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  const fields = [["facebook_url", "Facebook page"], ["instagram_url", "Instagram"], ["youtube_url", "YouTube"], ["x_url", "X profile"]] as const;
  return (
    <form className="max-w-2xl space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div><Label htmlFor="marquee">Scrolling text (one message per line, max 12)</Label><Textarea id="marquee" rows={5} value={marquee} onChange={(e) => setMarquee(e.target.value)} placeholder="Leave empty to show the default messages" /></div>
      <div><Label htmlFor="payment_info">Payment instructions (shown on the Premium page)</Label><Textarea id="payment_info" rows={4} value={paymentInfo} onChange={(e) => setPaymentInfo(e.target.value)} placeholder="e.g. JazzCash / EasyPaisa / bank details — where to send $2" /></div>
      <p className="text-sm text-muted-foreground">Social links: only filled links appear in the footer. Empty ones stay hidden.</p>
      {fields.map(([k, label]) => (
        <div key={k}><Label htmlFor={k}>{label}</Label><Input id={k} type="url" placeholder="https://…" value={links[k]} onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))} /></div>
      ))}
      <Button type="submit" disabled={busy}>Save site settings</Button>
    </form>
  );
}

type Conv = { id: string; type: string; name: string | null; conversation_members: { user_id: string; profiles: { username: string } | null }[] };

export function InspectUserButton({ userId, email }: { userId: string; email: string }) {
  const inspect = useServerFn(inspectUser);
  const read = useServerFn(readConversation);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<{ profile: { username: string; display_name: string; bio: string } | null; conversations: Conv[] } | null>(null);
  const [msgs, setMsgs] = useState<{ id: string; body: string | null; kind: string; file_name: string | null; created_at: string; profiles: { username: string } | null }[] | null>(null);
  async function start() {
    setOpen(true); setInfo(null); setMsgs(null);
    try { setInfo((await inspect({ data: { target: userId } })) as never); } catch (e) { toast.error(e instanceof Error ? e.message : "Not allowed"); setOpen(false); }
  }
  async function openConv(id: string) {
    try { setMsgs((await read({ data: { conversation: id, target: userId } })) as never); } catch (e) { toast.error(e instanceof Error ? e.message : "Not allowed"); }
  }
  return (
    <>
      <Button size="icon" variant="outline" title="View account and chats" aria-label={`View ${email}`} onClick={start}><Eye className="h-4 w-4" /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="break-all">{email}</DialogTitle></DialogHeader>
          {!info ? <p className="text-muted-foreground">Loading…</p> : (
            <div className="space-y-4 text-sm">
              {info.profile && <p><b>{info.profile.display_name}</b> · @{info.profile.username}<br /><span className="text-muted-foreground">{info.profile.bio}</span></p>}
              <p className="text-xs text-muted-foreground">Every view is recorded in the audit log.</p>
              <div className="space-y-1">
                {info.conversations.map((c) => (
                  <button key={c.id} onClick={() => openConv(c.id)} className="block w-full rounded-md border border-border px-3 py-2 text-left hover:bg-secondary">
                    {c.name || c.conversation_members.map((m) => `@${m.profiles?.username ?? "?"}`).join(", ")} <span className="text-xs text-muted-foreground">({c.type})</span>
                  </button>
                ))}
                {!info.conversations.length && <p className="text-muted-foreground">No chats.</p>}
              </div>
              {msgs && (
                <div className="space-y-2 border-t border-border pt-3">
                  {msgs.map((m) => (
                    <p key={m.id} className="break-words"><b>@{m.profiles?.username}</b>: {m.body || `[${m.kind}${m.file_name ? ` ${m.file_name}` : ""}]`} <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</span></p>
                  ))}
                  {!msgs.length && <p className="text-muted-foreground">No messages.</p>}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
