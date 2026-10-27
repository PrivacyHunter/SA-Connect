import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

async function sha(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function twilio(path: string, init?: RequestInit) {
  const key = process.env["LOVABLE_API_KEY"], tw = process.env["TWILIO_API_KEY"];
  if (!key || !tw) throw new Error("SMS service is not connected yet");
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "X-Connection-Api-Key": tw, ...(init?.headers ?? {}) } });
  const body = await res.text();
  if (!res.ok) throw new Error(`SMS failed [${res.status}]: ${body}`);
  return JSON.parse(body);
}

export const sendPhoneCode = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ phone: z.string().regex(/^\+\d{8,15}$/) })).handler(async ({ context, data }) => {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const prev = await admin.from("phone_verifications").select("updated_at").eq("user_id", context.userId).maybeSingle();
  if (prev.data && Date.now() - new Date(prev.data.updated_at).getTime() < 60_000) throw new Error("Please wait a minute before requesting another code");
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
  const numbers = await twilio("/IncomingPhoneNumbers.json?PageSize=1");
  const from = numbers.incoming_phone_numbers?.[0]?.phone_number;
  if (!from) throw new Error("No sending number on the SMS account");
  await twilio("/Messages.json", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ To: data.phone, From: from, Body: `Your SA Connect code is ${code}` }) });
  const r = await admin.from("phone_verifications").upsert({ user_id: context.userId, phone: data.phone, code_hash: await sha(`${context.userId}:${code}`), expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0, verified_at: null, updated_at: new Date().toISOString() });
  if (r.error) throw r.error;
  return { ok: true };
});

export const verifyPhoneCode = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ code: z.string().regex(/^\d{6}$/) })).handler(async ({ context, data }) => {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await admin.from("phone_verifications").select("*").eq("user_id", context.userId).maybeSingle();
  if (error) throw error;
  if (!row?.code_hash || !row.expires_at || new Date(row.expires_at) < new Date()) throw new Error("Code expired, request a new one");
  if (row.attempts >= 5) throw new Error("Too many attempts, request a new code");
  if ((await sha(`${context.userId}:${data.code}`)) !== row.code_hash) {
    await admin.from("phone_verifications").update({ attempts: row.attempts + 1 }).eq("user_id", context.userId);
    throw new Error("Wrong code");
  }
  const r = await admin.from("phone_verifications").update({ verified_at: new Date().toISOString(), code_hash: null }).eq("user_id", context.userId);
  if (r.error) throw r.error;
  return { ok: true };
});
