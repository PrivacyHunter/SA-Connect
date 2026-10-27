import { supabase } from "@/integrations/supabase/client";

const SIGNED_TTL = 60 * 60 * 24 * 6; // 6 days, under the 7-day cap

const cache = new Map<string, Promise<string>>();

/** Signed URL for a private-bucket object, cached per path. */
export function signedUrl(bucket: string, path: string): Promise<string> {
  const key = `${bucket}/${path}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_TTL)
    .then((r) => {
      if (r.error) throw r.error;
      return r.data.signedUrl;
    })
    .catch((e: unknown) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, promise);
  return promise;
}

/** Upload a file into the given bucket under the caller's own folder. Returns the storage path. */
export async function uploadFile(bucket: "avatars" | "media" | "payments", file: File): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error("Not signed in");
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Capture a mid-video frame of a local video file as a JPEG File. */
export async function captureVideoThumbnail(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const done = (result: File | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (!canvas.width || !canvas.height) return done(null);
      const ctx = canvas.getContext("2d");
      if (!ctx) return done(null);
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => done(blob ? new File([blob], "thumb.jpg", { type: "image/jpeg" }) : null),
        "image/jpeg",
        0.8,
      );
    };
    video.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

/** Read the duration of a local media file in seconds. */
export function readMediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    el.src = url;
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? Math.round(el.duration) : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    setTimeout(() => resolve(null), 8000);
  });
}
