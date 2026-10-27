import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Facebook, Instagram, Twitter, Wallet, X, Youtube } from "lucide-react";
import { Brand } from "@/components/brand";

const SOCIALS = [
  { key: "facebook_url", label: "Facebook", icon: Facebook },
  { key: "instagram_url", label: "Instagram", icon: Instagram },
  { key: "youtube_url", label: "YouTube", icon: Youtube },
  { key: "x_url", label: "X", icon: Twitter },
] as const;

export const siteSettingsQuery = {
  queryKey: ["site-settings"],
  queryFn: async () => {
    const { data, error } = await supabase.from("site_settings").select("*").maybeSingle();
    if (error) throw error;
    return data;
  },
};

const DEFAULT_MESSAGES = [
  "Welcome to SA Connect — chat, share, create",
  "Level up to 1000 and unlock unique badges",
  "Find friends by @username or from your contacts",
  "Sell and buy in the Marketplace",
  "Earn with SA Connect — coming soon",
];

export function Marquee() {
  const { data } = useQuery(siteSettingsQuery);
  const MESSAGES = data?.marquee?.length ? data.marquee : DEFAULT_MESSAGES;
  const items = [...MESSAGES, ...MESSAGES];
  return (
    <div className="marquee glass text-xs font-medium text-muted-foreground" aria-label="Announcements">
      <div className="marquee-track">
        {items.map((m, i) => (
          <span key={i} className="flex items-center gap-3" aria-hidden={i >= MESSAGES.length}>
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />{m}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SiteFooter() {
  const { data } = useQuery(siteSettingsQuery);
  const links = SOCIALS.map((x) => ({ ...x, href: data?.[x.key] ?? "" })).filter((x) => x.href);
  return (
    <footer className="mt-auto border-t border-glass-border glass px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-3"><Brand /><p className="max-w-xs text-xs text-muted-foreground">Your world, connected.</p></div>
        <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link to="/feed" className="hover:text-foreground">Feed</Link>
          <Link to="/marketplace" className="hover:text-foreground">Marketplace</Link>
          <Link to="/contacts" className="hover:text-foreground">Find friends</Link>
          <Link to="/income" className="hover:text-foreground">Income</Link>
        </nav>
        {links.length > 0 && <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Follow us</span>
          {links.map(({ label, href, icon: Icon }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={`Follow SA Connect on ${label}`} className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              <Icon className="h-4 w-4" />
            </a>
          ))}
        </div>}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} SA Connect</p>
    </footer>
  );
}

export function IncomePopup() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!sessionStorage.getItem("income-popup")) {
      const t = setTimeout(() => setShow(true), 2500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);
  if (!show) return null;
  const close = () => { sessionStorage.setItem("income-popup", "1"); setShow(false); };
  return (
    <div role="dialog" aria-label="Income coming soon" className="fixed bottom-20 right-4 z-50 w-72 rounded-md border border-glass-border glass p-4 shadow-[var(--shadow-glow)] lg:bottom-6">
      <button onClick={close} aria-label="Close" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      <p className="flex items-center gap-2 font-semibold"><Wallet className="h-5 w-5 text-primary" /> Income</p>
      <p className="mt-1 text-sm text-muted-foreground">Earn from your content on SA Connect. Coming soon!</p>
      <Link to="/income" onClick={close} className="mt-3 inline-block text-sm font-medium text-primary">Learn more →</Link>
    </div>
  );
}
