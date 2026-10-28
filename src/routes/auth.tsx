import { useEffect, useState, type FormEvent } from "react";
import { isDisposableEmail, passwordProblems } from "@/lib/signup-rules";
import { setupKeysAfterSignIn } from "@/lib/e2ee";
import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import scene from "@/assets/brand-scene.jpg";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; ref?: string } => {
    const raw = search["redirect"];
    const redirect =
      typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : undefined;
    const refRaw = search["ref"];
    const ref = typeof refRaw === "string" && refRaw.trim() ? refRaw.trim().toUpperCase() : undefined;
    return { ...(redirect ? { redirect } : {}), ...(ref ? { ref } : {}) };
  },
  head: () => ({
    meta: [
      { title: "Sign in — SA Connect" },
      { name: "description", content: "Sign in or create your SA Connect account." },
      { property: "og:title", content: "Sign in — SA Connect" },
      { property: "og:description", content: "Join SA Connect with Google or email." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

export function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [referral, setReferral] = useState(search.ref ?? "");
  const [refBy, setRefBy] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const after = search.redirect ?? "/feed";

  // Live check of a referral code: show who invited the new user
  useEffect(() => {
    const code = referral.trim().toUpperCase();
    if (!code) {
      setRefBy(null);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("referral_preview", { p_code: code });
      const row = (data as { display_name: string; username: string }[] | null)?.[0];
      setRefBy(row ? `${row.display_name} (@${row.username})` : "");
    }, 400);
    return () => clearTimeout(t);
  }, [referral]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: after, replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Recover or escrow the E2EE key pair with the login password before
        // any chat page loads, so a new device keeps decrypting history.
        const { data: auth } = await supabase.auth.getUser();
        if (auth.user) await setupKeysAfterSignIn(auth.user.id, password);
        navigate({ to: after, replace: true });
      } else {
        if (isDisposableEmail(email)) throw new Error("Temporary or disposable email addresses are not allowed. Use your real email.");
        const problems = passwordProblems(password);
        if (problems.length) throw new Error("Password needs " + problems.join(", ") + ".");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name.trim() || email.split("@")[0],
              referral_code: referral.trim().toUpperCase() || undefined,
            },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice("Account created! Check your email inbox and click the confirmation link, then sign in here.");
        } else {
          if (data.user) await setupKeysAfterSignIn(data.user.id, password);
          navigate({ to: after, replace: true });
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function social() {
    setBusy(true);
    try {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) toast.error(result.error.message);
    if (!result.redirected && !result.error) navigate({ to: after, replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign-in failed");
    } finally { setBusy(false); }
  }

  async function forgot() {
    if (!email) {
      toast.error("Enter your email first");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else setNotice("Password reset link sent — check your email.");
  }

  return (
    <div className="auth-stage">
      <img src={scene} alt="" className="auth-backdrop" aria-hidden="true" />
      <header className="auth-header"><Brand /><ThemeToggle /></header>
      <main className="auth-main">
      <section className="auth-panel">
        <div className="auth-panel-heading">
          <span className="auth-eyebrow"><span /> YOUR WORLD. CONNECTED.</span>
          <h1 className="font-display text-3xl font-bold">{mode === "signin" ? "Welcome back." : "Make your connection."}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{mode === "signin" ? "Your people. Your moments. Your space." : "A new chapter starts with you."}</p>
        </div>
        <div className="auth-tabs">
          <Button variant="ghost" className={mode === "signin" ? "auth-tab-active" : ""} onClick={() => { setMode("signin"); setNotice(null); }}>Sign in</Button>
          <Button variant="ghost" className={mode === "signup" ? "auth-tab-active" : ""} onClick={() => { setMode("signup"); setNotice(null); }}>Create account</Button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-name">Display name</Label>
              <Input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
          )}
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-ref">Referral code (optional)</Label>
              <Input
                id="auth-ref"
                value={referral}
                onChange={(e) => setReferral(e.target.value.toUpperCase())}
                placeholder="Friend's code, e.g. 7F3K2M9Q"
                maxLength={12}
                className="tracking-widest"
              />
              {referral.trim() && (
                <p className="text-xs text-muted-foreground">
                  {refBy === null
                    ? "Checking code…"
                    : refBy === ""
                      ? "Code not recognized — check with your friend"
                      : `Invited by ${refBy} ✓`}
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-pass">Password</Label>
            <div className="relative"><Input
              id="auth-pass"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="pr-12"
            /><Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div>
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            <ArrowRight className="mr-1 h-4 w-4" />
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {mode === "signin" && (
          <Button variant="link" onClick={forgot} className="mt-2 h-auto p-0 text-xs text-muted-foreground">
            Forgot password?
          </Button>
        )}

        {notice && (
          <p className="mt-3 rounded-xl bg-accent p-3 text-sm text-accent-foreground">{notice}</p>
        )}

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or continue with <span className="h-px flex-1 bg-border" />
        </div>

        <div>
          <Button variant="secondary" className="w-full" disabled={busy} onClick={social}>
            <svg viewBox="0 0 24 24" className="mr-1.5 h-4 w-4">
              <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.03c2.2-2.05 3.5-5.05 3.5-8.58z" />
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-.14.01-3.6 2.8-.05.13C3.3 21.3 7.3 24 12 24z" />
              <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.01-.16-3.7-2.8-.12.06C.4 8.3 0 10.1 0 12s.4 3.7 1.4 5.3l3.8-2.9z" />
              <path fill="#EA4335" d="M12 4.6c2.2 0 3.7 1 4.6 1.8l3.3-3.2C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.4 6.7l3.8 2.9c1-2.9 3.7-5 6.8-5z" />
            </svg>
            Continue with Google
          </Button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> Your connection, kept private.</p>
      </section>
      </main>
      <footer className="auth-footer"><span>© SA Connect</span><span>CHAT · SHARE · WATCH · CONNECT</span></footer>
    </div>
  );
}
