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
