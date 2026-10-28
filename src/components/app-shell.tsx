import { useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Clapperboard,
  LogOut,
  MessageCircle,
  MonitorPlay,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  User,
  Users,
  ShoppingBag,
  ShieldCheck,
  Wallet,
  Crown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { IncomePopup, Marquee, SiteFooter } from "@/components/site-chrome";
import { ChatNotifier } from "@/components/chat-notifier";
import { CallProvider } from "@/lib/call-engine";
import { NotificationBell } from "@/components/notification-bell";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/use-current-user";
import { OnlineProvider } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "@/components/brand";
import { UserAvatar } from "@/components/user-avatar";
import type { Profile } from "@/lib/types";

const NAV = [
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/calls", label: "Calls", icon: Phone },
  { to: "/feed", label: "Feed", icon: Newspaper },
  { to: "/reels", label: "Reels", icon: Clapperboard },
  { to: "/videos", label: "Videos", icon: MonitorPlay },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { to: "/income", label: "Income", icon: Wallet },
  { to: "/premium", label: "Premium", icon: Crown },
] as const;

export function AppShell() {
  const { data: me } = useCurrentProfile();
  return (
    <OnlineProvider userId={me?.id ?? null}>
      <CallProvider meId={me?.id}>
        <Shell me={me} />
      </CallProvider>
    </OnlineProvider>
  );
}

function Shell({ me }: { me: Profile | null | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const staff = useQuery({
    queryKey: ["my-role", me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", me!.id).maybeSingle();
      return !!data;
    },
  });
  const profileTo = me ? `/profile/${me.username}` : "/feed";

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navItem = (item: (typeof NAV)[number], compact: boolean) => {
    const active = pathname.startsWith(item.to);
    const Icon = item.icon;
    return (
      <Link
        key={item.to}
        to={item.to}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "bg-primary/15 text-gold"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <Icon className={cn("h-5 w-5 shrink-0", active && "text-gold")} />
        {!compact && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-glass-border glass transition-all duration-300 lg:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className="flex items-center gap-2.5 px-4 py-5">
          <Brand compact={collapsed} />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => navItem(item, collapsed))}
          {staff.data && navItem({ to: "/panel", label: "Panel", icon: ShieldCheck } as unknown as (typeof NAV)[number], collapsed)}
          <Link
            to={profileTo}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              pathname.startsWith("/profile")
                ? "bg-primary/15 text-gold"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <User className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Profile</span>}
          </Link>
        </nav>
        <div className="flex flex-col gap-1 px-3 pb-4">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
            {!collapsed && <span>Collapse</span>}
          </button>
          <div className="my-1 h-px bg-border" />
          <div className={cn("flex items-center gap-1", collapsed ? "flex-col" : "px-1")}>
            <NotificationBell meId={me?.id} />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </Button>
            {me && (
              <Link to={profileTo} className="ml-auto" aria-label="Your profile">
                <UserAvatar profile={me} size="sm" showOnline />
              </Link>
            )}
          </div>
          {!collapsed && me && (
            <div className="mt-2 truncate px-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{me.display_name}</span> · @{me.username}
            </div>
          )}
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-glass-border glass px-4 lg:hidden">
        <Link to="/feed" className="flex items-center gap-2">
          <Brand />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell meId={me?.id} />
          <Link to="/contacts" aria-label="Contacts" className="p-2"><Users className="h-5 w-5" /></Link>
          <Link to="/marketplace" aria-label="Marketplace" className="p-2"><ShoppingBag className="h-5 w-5" /></Link>
          <Link to="/premium" aria-label="Premium" className="p-2"><Crown className="h-5 w-5" /></Link>
          <ThemeToggle />
          {me && (
            <Link to={profileTo} aria-label="Your profile">
              <UserAvatar profile={me} size="sm" showOnline />
            </Link>
          )}
        </div>
      </header>

      {/* Content */}
      <main className={cn("flex min-h-screen flex-col pb-20 lg:pb-0", collapsed ? "lg:pl-[76px]" : "lg:pl-64")}>
        <Marquee />
        <div className="flex-1"><Outlet /></div>
        <SiteFooter />
      </main>
      <IncomePopup />
      <ChatNotifier meId={me?.id} />

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 items-center border-t border-glass-border glass pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.slice(0, 2).map((item) => (
          <BottomItem key={item.to} item={item} pathname={pathname} />
        ))}
        <Link
          to="/feed"
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-gold-deep text-primary-foreground shadow-[var(--shadow-glow)]"
          aria-label="New post"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
        {NAV.slice(2,4).map((item) => (
          <BottomItem key={item.to} item={item} pathname={pathname} />
        ))}
      </nav>
    </div>
  );
}

function BottomItem({ item, pathname }: { item: (typeof NAV)[number]; pathname: string }) {
  const active = pathname.startsWith(item.to);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        "flex flex-col items-center gap-0.5 text-[10px] font-medium transition-colors",
        active ? "text-gold" : "text-muted-foreground",
      )}
    >
      <Icon className={cn("h-5 w-5", active && "scale-110")} />
      {item.label}
    </Link>
  );
}
