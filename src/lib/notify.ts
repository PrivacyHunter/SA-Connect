/** Notification + ringtone helpers (Web Audio tones, browser notifications). */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, gain = 0.12, type: OscillatorType = "sine") {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** Short chime for an incoming message. */
export function playMessageSound() {
  try {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(880, t, 0.09);
    tone(1174.66, t + 0.1, 0.14);
  } catch {
    /* ignore */
  }
}

/** Classic ringback: the callee's phone is ringing (callee online). */
export function startOutgoingRing(): () => void {
  try {
    const c = audio();
    if (!c) return () => {};
    const beep = () => {
      const t = c.currentTime;
      tone(440, t, 1.8, 0.09);
      tone(480, t, 1.8, 0.09);
    };
    beep();
    const iv = window.setInterval(beep, 4200);
    return () => window.clearInterval(iv);
  } catch {
    return () => {};
  }
}

/** Distinct incoming-call trill; slightly higher pitch for video calls. */
export function startIncomingRing(video = false): () => void {
  try {
    const c = audio();
    if (!c) return () => {};
    const base = video ? 880 : 740;
    const beep = () => {
      const t = c.currentTime;
      tone(base, t, 0.18, 0.16, "triangle");
      tone(base * 1.25, t + 0.2, 0.18, 0.16, "triangle");
      tone(base, t + 0.4, 0.18, 0.16, "triangle");
      tone(base * 1.25, t + 0.6, 0.35, 0.16, "triangle");
    };
    beep();
    const iv = window.setInterval(beep, 2400);
    return () => window.clearInterval(iv);
  } catch {
    return () => {};
  }
}

/** "User is offline" tone: three low beeps, then a pause. */
export function startOfflineTone(): () => void {
  try {
    const c = audio();
    if (!c) return () => {};
    const beep = () => {
      const t = c.currentTime;
      tone(320, t, 0.12, 0.14, "square");
      tone(320, t + 0.18, 0.12, 0.14, "square");
      tone(320, t + 0.36, 0.22, 0.14, "square");
    };
    beep();
    const iv = window.setInterval(beep, 3600);
    return () => window.clearInterval(iv);
  } catch {
    return () => {};
  }
}

/** Short descending beep when a call ends, is declined or goes unanswered. */
export function playCallEnded() {
  try {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(660, t, 0.12, 0.14);
    tone(440, t + 0.15, 0.25, 0.14);
  } catch {
    /* ignore */
  }
}

/** Looping ringtone for an incoming call. Returns a stop function. */
export function startRingtone(): () => void {
  try {
    const c = audio();
    if (!c) return () => {};
    const beep = () => {
      const t = c.currentTime;
      tone(783.99, t, 0.22, 0.15, "triangle");
      tone(987.77, t + 0.28, 0.22, 0.15, "triangle");
      tone(783.99, t + 0.56, 0.3, 0.15, "triangle");
    };
    beep();
    const iv = window.setInterval(beep, 1800);
    return () => window.clearInterval(iv);
  } catch {
    return () => {};
  }
}

export async function ensureNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
}

/** Browser notification, shown when the tab is in the background. */
export function showNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  try {
    new Notification(title, { body, icon: "/favicon.png" });
  } catch {
    /* ignore */
  }
}
