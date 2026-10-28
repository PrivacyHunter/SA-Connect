import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { playCallEnded, startIncomingRing, startOfflineTone, startOutgoingRing } from "@/lib/notify";
import { useOnlineUsers } from "@/lib/presence";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

type Status = "idle" | "calling" | "ringing" | "connected";
type CallKind = "voice" | "video";
type Peer = { id: string; name: string; avatar_url: string | null };

type SignalRow = {
  id: string;
  conversation_id: string;
  from_user: string;
  to_user: string;
  type: "offer" | "answer" | "ice" | "end";
  payload: {
    sdp?: RTCSessionDescriptionInit;
    video?: boolean;
    candidate?: RTCIceCandidateInit;
    reason?: string;
  };
};

interface CallEngine {
  status: Status;
  kind: CallKind;
  peer: Peer | null;
  /** True while the callee is not connected to the app (unique "offline" ring). */
  offline: boolean;
  muted: boolean;
  cameraOff: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  start(conversationId: string, calleeId: string, calleeName: string, video: boolean): void;
  accept(): void;
  end(): void;
  toggleMute(): void;
  toggleCamera(): void;
}

const CallContext = createContext<CallEngine | null>(null);

export function useCallEngine(): CallEngine {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCallEngine must be used inside CallProvider");
  return ctx;
}

/**
 * WhatsApp-style 1:1 calls. Signalling runs through the `call_signals` table
 * delivered by realtime, so an incoming call rings anywhere in the app — not
 * only while the conversation is open. Call history is written to `call_log`
 * and missed calls raise a bell notification for the callee.
 */
export function CallProvider({ meId, children }: { meId: string | null | undefined; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [kind, setKind] = useState<CallKind>("voice");
  const [peer, setPeer] = useState<Peer | null>(null);
  const [offline, setOffline] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const onlineSet = useOnlineUsers();
  const onlineRef = useRef<Set<string>>(onlineSet);
  useEffect(() => {
    onlineRef.current = onlineSet;
  }, [onlineSet]);

  const statusRef = useRef<Status>("idle");
  const kindRef = useRef<CallKind>("voice");
  const peerRef = useRef<Peer | null>(null);
  const convRef = useRef<string | null>(null);
  const callerRef = useRef(false);
  const logIdRef = useRef<string | null>(null);
  const startedRef = useRef(0);
  const pendingOffer = useRef<SignalRow | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);

  const setState = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopRingRef.current?.();
    stopRingRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingOffer.current = null;
    pendingIce.current = [];
    callerRef.current = false;
    logIdRef.current = null;
    startedRef.current = 0;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    setOffline(false);
    setPeer(null);
    setState("idle");
  };

  /** Write the final state of the caller's call-log row. */
  const finalize = async (logStatus: "answered" | "missed" | "declined" | "cancelled", notifyReason?: string) => {
    const logId = logIdRef.current;
    const callee = peerRef.current?.id;
    const conversationId = convRef.current;
    const duration = startedRef.current ? Math.round((Date.now() - startedRef.current) / 1000) : 0;
    if (!logId || !callee || !conversationId) return;
    await supabase
      .from("call_log")
      .update({ status: logStatus, duration_seconds: duration, updated_at: new Date().toISOString() })
      .eq("id", logId);
    if (logStatus === "missed" && callerRef.current) {
      await supabase.rpc("notify_missed_call", {
        _conversation: conversationId,
        _callee: callee,
        _kind: kindRef.current,
        _reason: notifyReason ?? "no-answer",
      });
    }
  };

  const flushIce = async () => {
    for (const c of pendingIce.current) await pcRef.current?.addIceCandidate(c).catch(() => {});
    pendingIce.current = [];
  };

  const makePeer = (stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      const conv = convRef.current;
      const to = peerRef.current?.id;
      if (e.candidate && meId && conv && to && statusRef.current !== "idle") {
        void supabase.from("call_signals").insert({
          conversation_id: conv,
          from_user: meId,
          to_user: to,
          type: "ice",
          payload: { candidate: e.candidate.toJSON() } as unknown as Json,
        });
      }
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? null);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && statusRef.current !== "connected") {
        startedRef.current = Date.now();
        setState("connected");
      }
      if (pc.connectionState === "failed") {
        toast.error("Call connection failed");
        void finalize(callerRef.current ? (startedRef.current ? "answered" : "missed") : "cancelled");
        playCallEnded();
        cleanup();
      }
    };
    pcRef.current = pc;
    return pc;
  };

  const getMedia = async (withVideo: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  };

  async function handleSignal(row: SignalRow) {
    if (row.from_user === meId) return;
    try {
      if (row.type === "offer") {
        if (statusRef.current !== "idle") {
          await supabase.from("call_signals").insert({
            conversation_id: row.conversation_id,
            from_user: meId!,
            to_user: row.from_user,
            type: "end",
            payload: { reason: "busy" },
          });
        } else {
          pendingOffer.current = row;
          const k: CallKind = row.payload.video ? "video" : "voice";
          kindRef.current = k;
          setKind(k);
          const { data: profile } = await supabase
            .from("profiles")
            .select("display_name, avatar_url")
            .eq("id", row.from_user)
            .maybeSingle();
          const p: Peer = { id: row.from_user, name: profile?.display_name ?? "Unknown", avatar_url: profile?.avatar_url ?? null };
          peerRef.current = p;
          setPeer(p);
          callerRef.current = false;
          convRef.current = row.conversation_id;
          setState("ringing");
        }
      } else if (row.type === "answer") {
        if (row.payload.sdp) {
          await pcRef.current?.setRemoteDescription(row.payload.sdp);
          await flushIce();
        }
      } else if (row.type === "ice") {
        if (row.payload.candidate) {
          if (pcRef.current?.remoteDescription) await pcRef.current.addIceCandidate(row.payload.candidate).catch(() => {});
          else pendingIce.current.push(row.payload.candidate);
        }
      } else if (row.type === "end") {
        if (statusRef.current !== "idle") {
          const reason = row.payload.reason ?? "ended";
          if (callerRef.current) {
            await finalize(startedRef.current ? "answered" : statusRef.current === "calling" ? "declined" : "cancelled");
          }
          toast(reason === "busy" ? "User is on another call" : reason === "declined" ? "Call declined" : "Call ended");
          playCallEnded();
          cleanup();
        }
      }
    } finally {
      void supabase.from("call_signals").delete().eq("id", row.id);
    }
  }

  // Global signalling channel: rings no matter which page is open.
  useEffect(() => {
    if (!meId) return;
    const channel = supabase.channel(`call-signals-${meId}`, { config: { broadcast: { self: false } } });
    channel
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals", filter: `to_user=eq.${meId}` }, (payload) => {
        void handleSignal(payload.new as SignalRow);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  // Distinct ringtones: outgoing online, outgoing offline, incoming.
  useEffect(() => {
    if (status === "calling") {
      stopRingRef.current = offline ? startOfflineTone() : startOutgoingRing();
    } else if (status === "ringing") {
      stopRingRef.current = startIncomingRing(kind === "video");
    } else {
      stopRingRef.current?.();
      stopRingRef.current = null;
    }
    return () => {
      stopRingRef.current?.();
      stopRingRef.current = null;
    };
  }, [status, offline, kind]);

  // Caller-side timeouts: offline → 20s, online but unanswered → 45s.
  function beginTimeouts() {
    const t0 = Date.now();
    timerRef.current = window.setInterval(() => {
      const callee = peerRef.current;
      if (!callee || statusRef.current !== "calling") return;
      const isOnline = onlineRef.current.has(callee.id);
      setOffline(!isOnline);
      const elapsed = Date.now() - t0;
      if (!isOnline && elapsed > 20_000) {
        void finalize("missed", "offline");
        toast(`${callee.name} is offline`);
        playCallEnded();
        cleanup();
      } else if (isOnline && elapsed > 45_000) {
        void finalize("missed", "no-answer");
        toast("No answer");
        playCallEnded();
        cleanup();
      }
    }, 2000);
  }

  async function start(conversationId: string, calleeId: string, calleeName: string, video: boolean) {
    if (!meId || statusRef.current !== "idle") return;
    const k: CallKind = video ? "video" : "voice";
    kindRef.current = k;
    setKind(k);
    const initial: Peer = { id: calleeId, name: calleeName, avatar_url: null };
    peerRef.current = initial;
    setPeer(initial);
    convRef.current = conversationId;
    callerRef.current = true;
    setState("calling");
    try {
      void supabase.from("call_signals").delete().eq("from_user", meId); // clear stale signals
      const { data: log, error: logErr } = await supabase
        .from("call_log")
        .insert({ conversation_id: conversationId, caller_id: meId, callee_id: calleeId, kind: k })
        .select("id")
        .single();
      if (logErr) throw logErr;
      logIdRef.current = log?.id ?? null;
      const stream = await getMedia(video);
      const pc = makePeer(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const { error } = await supabase.from("call_signals").insert({
        conversation_id: conversationId,
        from_user: meId,
        to_user: calleeId,
        type: "offer",
        payload: { sdp: offer, video } as unknown as Json,
      });
      if (error) throw error;
      beginTimeouts();
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", calleeId)
        .maybeSingle();
      if (profile && peerRef.current?.id === calleeId) {
        const p: Peer = { id: calleeId, name: profile.display_name, avatar_url: profile.avatar_url };
        peerRef.current = p;
        setPeer(p);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the call");
      void finalize("cancelled");
      cleanup();
    }
  }

  async function accept() {
    const offer = pendingOffer.current;
    if (!offer || statusRef.current !== "ringing") return;
    try {
      const stream = await getMedia(kindRef.current === "video");
      const pc = makePeer(stream);
      await pc.setRemoteDescription(offer.payload.sdp!);
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await supabase.from("call_signals").insert({
        conversation_id: offer.conversation_id,
        from_user: meId!,
        to_user: offer.from_user,
        type: "answer",
        payload: { sdp: answer } as unknown as Json,
      });
      startedRef.current = Date.now();
      setState("connected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join the call");
      end();
    }
  }

  function end() {
    const to = peerRef.current?.id;
    const conv = convRef.current;
    if (meId && to && conv && statusRef.current !== "idle") {
      void supabase.from("call_signals").insert({
        conversation_id: conv,
        from_user: meId,
        to_user: to,
        type: "end",
        payload: { reason: "ended" },
      });
    }
    if (callerRef.current) void finalize(startedRef.current ? "answered" : "cancelled");
    playCallEnded();
    cleanup();
  }

  function toggleMute() {
    const next = !muted;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  function toggleCamera() {
    const next = !cameraOff;
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCameraOff(next);
  }

  const value: CallEngine = {
    status,
    kind,
    peer,
    offline,
    muted,
    cameraOff,
    localStream,
    remoteStream,
    start,
    accept,
    end,
    toggleMute,
    toggleCamera,
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay />
    </CallContext.Provider>
  );
}

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

/** Full-screen call stage shown for whichever page the user is on. */
export function CallOverlay() {
  const call = useCallEngine();
  if (call.status === "idle" || !call.peer) return null;
  const label =
    call.status === "calling"
      ? call.offline
        ? `${call.peer.name} is offline — calling…`
        : "Ringing… (online)"
      : call.status === "ringing"
        ? `Incoming ${call.kind === "video" ? "video" : "voice"} call`
        : "Connected";
  return (
    <div className="call-stage" role="dialog" aria-label={`${call.kind} call`}>
      {call.kind === "video" && <StreamVideo stream={call.remoteStream} className="call-remote" />}
      <div className="call-info">
        <div className="mb-2">
          <UserAvatar
            profile={{ id: call.peer.id, display_name: call.peer.name, avatar_url: call.peer.avatar_url }}
            size="xl"
          />
        </div>
        <h3 className="font-display text-2xl font-bold">{call.peer.name}</h3>
        <p className={cn("text-sm", call.status === "calling" && call.offline ? "text-muted-foreground" : "text-gold")}>{label}</p>
      </div>
      {call.kind === "video" && call.localStream && (
        <StreamVideo stream={call.localStream} muted className={cn("call-local", call.cameraOff && "opacity-30")} />
      )}
      <div className="call-controls">
        {call.status === "ringing" ? (
          <>
            <Button size="icon" variant="destructive" className="call-btn" onClick={call.end} aria-label="Decline">
              <PhoneOff />
            </Button>
            <Button size="icon" className="call-btn" onClick={call.accept} aria-label="Accept">
              <Phone />
            </Button>
          </>
        ) : (
          <>
            <Button size="icon" variant="secondary" className="call-btn" onClick={call.toggleMute} aria-label={call.muted ? "Unmute" : "Mute"}>
              {call.muted ? <MicOff /> : <Mic />}
            </Button>
            {call.kind === "video" && call.status !== "calling" && (
              <Button
                size="icon"
                variant="secondary"
                className="call-btn"
                onClick={call.toggleCamera}
                aria-label={call.cameraOff ? "Camera on" : "Camera off"}
              >
                {call.cameraOff ? <VideoOff /> : <Video />}
              </Button>
            )}
            <Button size="icon" variant="destructive" className="call-btn" onClick={call.end} aria-label="End call">
              <PhoneOff />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
