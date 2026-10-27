import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canAssignRole, canManageAccount, type ManagementRole } from "./management-rules";

export const getPanel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const access = await context.supabase.rpc("account_can_write");
  if (access.error) throw access.error;
  if (!access.data) return { authorized: false as const };
  const { data: role, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId).maybeSingle();
  if (error) throw error;
  if (!role) return { authorized: false as const };
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const [users, roles, controls, posts, reels, videos, listings, payments, premium] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), admin.from("user_roles").select("*"), admin.from("account_controls").select("*"),
    admin.from("posts").select("id,caption,author_id,created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("reels").select("id,caption,author_id,created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("videos").select("id,title,channel_id,created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("marketplace_listings").select("id,title,seller_id,created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("payment_requests").select("id,user_id,screenshot_path,note,status,created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("premium_access").select("user_id,premium_until"),
  ]);
  for (const result of [users, roles, controls, posts, reels, videos, listings, payments, premium]) if (result.error) throw result.error;
  return { authorized: true as const, role: role.role as ManagementRole, userId: context.userId,
    users: users.data.users.map(u => ({ id: u.id, email: u.email ?? "", created: u.created_at, role: roles.data?.find(r => r.user_id === u.id)?.role as ManagementRole | undefined, status: controls.data?.find(c => c.user_id === u.id)?.status ?? "active", premium_until: premium.data?.find(p => p.user_id === u.id)?.premium_until ?? null })),
    payments: payments.data ?? [],
    content: [ ...(posts.data ?? []).map(p => ({ id: p.id, title: p.caption, userId: p.author_id, type: "posts" as const })), ...(reels.data ?? []).map(p => ({ id: p.id, title: p.caption, userId: p.author_id, type: "reels" as const })), ...(videos.data ?? []).map(p => ({ id: p.id, title: p.title, userId: p.channel_id, type: "videos" as const })), ...(listings.data ?? []).map(p => ({ id: p.id, title: p.title, userId: p.seller_id, type: "marketplace_listings" as const })) ] };
});

const actionSchema = z.object({ target: z.string().uuid().optional(), action: z.enum(["active","suspended","frozen","banned","deleted","role","reset","create","content","premium","approve_payment","reject_payment"]), role: z.enum(["admin","owner","developer"]).optional(), email: z.string().email().max(255).optional(), password: z.string().min(8).max(128).optional(), table: z.enum(["posts","reels","videos","marketplace_listings"]).optional(), redirect: z.string().url().optional(), months: z.number().int().min(0).max(24).optional() });
export const manageAccount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(actionSchema).handler(async ({ context, data }) => {
  const access = await context.supabase.rpc("account_can_write");
  if (access.error || !access.data) throw new Error("This account cannot manage the platform");
  const { data: actor, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId).maybeSingle();
  if (error || !actor) throw new Error("Panel access denied");
  const actorRole = actor.role as ManagementRole;
  if (data.action === "role" && (!data.role || !canAssignRole(actorRole, data.role))) throw new Error("Only an owner can appoint developers. Admins cannot change roles.");
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  // Payment approvals target a request id, not a user account.
  if (data.action === "approve_payment" || data.action === "reject_payment") {
    if (!data.target) throw new Error("Select a payment request");
    const { data: req, error: reqError } = await admin.from("payment_requests").select("id,user_id,status").eq("id", data.target).maybeSingle();
    if (reqError || !req) throw new Error("Payment request not found");
    const status = data.action === "approve_payment" ? "approved" : "rejected";
    const upd = await admin.from("payment_requests").update({ status, reviewed_by: context.userId }).eq("id", data.target);
    if (upd.error) throw upd.error;
    if (status === "approved") {
      const { data: existing } = await admin.from("premium_access").select("premium_until").eq("user_id", req.user_id).maybeSingle();
      const base = existing?.premium_until && new Date(existing.premium_until) > new Date() ? new Date(existing.premium_until) : new Date();
      const until = new Date(base.getTime() + 30 * 86400000).toISOString();
      const up = await admin.from("premium_access").upsert({ user_id: req.user_id, premium_until: until, updated_at: new Date().toISOString() });
      if (up.error) throw up.error;
    }
    const audit = await admin.from("admin_audit").insert({ actor_id: context.userId, target_id: req.user_id, action: data.action });
    if (audit.error) throw audit.error;
    const notify = await admin.from("user_notifications").insert({
      user_id: req.user_id,
      title: status === "approved" ? "Premium approved" : "Payment rejected",
      body:
        status === "approved"
          ? "Your $2 payment was approved — Premium is active for 30 days."
          : "Your premium payment proof was rejected. Please check the payment details on the Premium page and submit again.",
      kind: status === "approved" ? "success" : "warning",
    });
    if (notify.error) throw notify.error;
    return { ok: true };
  }
  let target = data.target;
  if (data.action === "content") {
    if (!target || !data.table) throw new Error("Select content");
    const ownerColumn = data.table === "videos" ? "channel_id" : data.table === "marketplace_listings" ? "seller_id" : "author_id";
    const { data: row, error: rowError } = await admin.from(data.table).select("*").eq("id", target).single();
    if (rowError) throw rowError;
    target = String((row as unknown as Record<string, unknown>)[ownerColumn]);
  }
  if (target) {
    const { data: targetRole, error: roleError } = await admin.from("user_roles").select("role").eq("user_id", target).maybeSingle();
    if (roleError) throw roleError;
    if (!canManageAccount(actorRole, targetRole?.role as ManagementRole ?? null, target === context.userId)) throw new Error("You cannot modify this privileged account or your own account here");
  }
  if (data.action === "create") {
    if (!data.email || !data.password) throw new Error("Email and temporary password required");
    const result = await admin.auth.admin.createUser({ email: data.email, password: data.password, email_confirm: true });
    if (result.error) throw result.error;
    target = result.data.user.id;
  } else if (data.action === "content") {
    if (!data.table || !data.target) throw new Error("Select content");
    const result = await admin.from(data.table).delete().eq("id", data.target); if (result.error) throw result.error;
  } else {
    if (!target) throw new Error("Select an account");
    if (data.action === "role") {
      if (!data.role) throw new Error("Select a role");
      const result = await admin.from("user_roles").upsert({ user_id: target, role: data.role }); if (result.error) throw result.error;
    } else if (data.action === "reset") {
      const user = await admin.auth.admin.getUserById(target); if (user.error) throw user.error;
      if (!user.data.user.email) throw new Error("No email for this account");
      const request = (await import("@tanstack/react-start/server")).getRequest();
      const origin = request.headers.get("origin");
      if (!origin || data.redirect !== `${origin}/reset-password`) throw new Error("Invalid reset destination");
      const result = await admin.auth.resetPasswordForEmail(user.data.user.email, { redirectTo: data.redirect }); if (result.error) throw result.error;
    } else if (data.action === "premium") {
      if (!target) throw new Error("Select an account");
      if (!data.months) {
        const { data: cur } = await admin.from("premium_access").select("premium_until").eq("user_id", target).maybeSingle();
        if (cur?.premium_until && new Date(cur.premium_until).getFullYear() > 9000) {
          throw new Error("This account always keeps Premium");
        }
        const result = await admin.from("premium_access").delete().eq("user_id", target); if (result.error) throw result.error;
        const notify = await admin.from("user_notifications").insert({
          user_id: target, title: "Premium removed",
          body: "Your Premium access was removed by the team.", kind: "warning",
        }); if (notify.error) throw notify.error;
      } else {
        const { data: existing } = await admin.from("premium_access").select("premium_until").eq("user_id", target).maybeSingle();
        const base = existing?.premium_until && new Date(existing.premium_until) > new Date() ? new Date(existing.premium_until) : new Date();
        const until = new Date(base.getTime() + data.months * 30 * 86400000).toISOString();
        const result = await admin.from("premium_access").upsert({ user_id: target, premium_until: until, updated_at: new Date().toISOString() }); if (result.error) throw result.error;
        const notify = await admin.from("user_notifications").insert({
          user_id: target, title: "Premium granted",
          body: `The team granted you ${data.months} month${data.months === 1 ? "" : "s"} of Premium — enjoy!`, kind: "success",
        }); if (notify.error) throw notify.error;
      }
    } else {
      const result = await admin.from("account_controls").upsert({ user_id: target, status: data.action, updated_at: new Date().toISOString() }); if (result.error) throw result.error;
      const authResult = await admin.auth.admin.updateUserById(target, { ban_duration: ["suspended","banned","deleted"].includes(data.action) ? "876000h" : "none" }); if (authResult.error) throw authResult.error;
    }
  }
  const audit = await admin.from("admin_audit").insert({ actor_id: context.userId, target_id: target ?? null, action: data.action === "role" ? `role:${data.role}` : data.action === "premium" ? `premium:${data.months ?? 0}m` : data.action }); if (audit.error) throw audit.error;
  return { ok: true };
});