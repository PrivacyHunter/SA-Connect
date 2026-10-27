import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

/** Only developers and owners may moderate private content or change site settings. */
async function requireSeniorStaff(context: Ctx) {
  const access = await context.supabase.rpc("account_can_write");
  if (access.error || !access.data) throw new Error("This account cannot manage the platform");
  const { data, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId).maybeSingle();
  if (error || !data || !["developer", "owner"].includes(data.role)) throw new Error("Only developers and owners can do this");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const url = z.string().trim().max(300).refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "Links must start with https://");
const settingsSchema = z.object({
  marquee: z.array(z.string().trim().min(1).max(160)).max(12),
  facebook_url: url, instagram_url: url, youtube_url: url, x_url: url,
  payment_info: z.string().max(4000),
});

export const saveSiteSettings = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(settingsSchema).handler(async ({ context, data }) => {
  const admin = await requireSeniorStaff(context as Ctx);
  const r = await admin.from("site_settings").update({ ...data, updated_at: new Date().toISOString() }).eq("id", true);
  if (r.error) throw r.error;
  await admin.from("admin_audit").insert({ actor_id: context.userId, action: "site_settings" });
  return { ok: true };
});

/** Signed, short-lived URL for a payment screenshot (staff only). */
export const paymentScreenshotUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ path: z.string().min(1).max(400) })).handler(async ({ context, data }) => {
  const admin = await requireSeniorStaff(context as Ctx);
  const { data: role } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId).maybeSingle();
  if (!role) throw new Error("Panel access denied");
  const r = await admin.storage.from("payments").createSignedUrl(data.path, 600);
  if (r.error) throw r.error;
  return r.data.signedUrl;
});

export const inspectUser = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ target: z.string().uuid() })).handler(async ({ context, data }) => {
  const admin = await requireSeniorStaff(context as Ctx);
  const [profile, members] = await Promise.all([
    admin.from("profiles").select("*").eq("id", data.target).maybeSingle(),
    admin.from("conversation_members").select("conversation_id").eq("user_id", data.target),
  ]);
  if (profile.error) throw profile.error;
  if (members.error) throw members.error;
  const ids = (members.data ?? []).map((m: { conversation_id: string }) => m.conversation_id);
  const conversations = ids.length ? await admin.from("conversations").select("id,type,name,last_message_at,conversation_members(user_id,profiles(username,display_name))").in("id", ids).order("last_message_at", { ascending: false, nullsFirst: false }) : { data: [], error: null };
  if (conversations.error) throw conversations.error;
  await admin.from("admin_audit").insert({ actor_id: context.userId, target_id: data.target, action: "inspect_user" });
  return { profile: profile.data, conversations: conversations.data ?? [] };
});

export const readConversation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ conversation: z.string().uuid(), target: z.string().uuid() })).handler(async ({ context, data }) => {
  const admin = await requireSeniorStaff(context as Ctx);
  const r = await admin.from("messages").select("id,body,kind,file_name,created_at,sender_id,profiles!messages_sender_id_fkey(username)").eq("conversation_id", data.conversation).order("created_at", { ascending: false }).limit(200);
  if (r.error) throw r.error;
  await admin.from("admin_audit").insert({ actor_id: context.userId, target_id: data.target, action: `read_conversation:${data.conversation}` });
  return r.data.reverse();
});
