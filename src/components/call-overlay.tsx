import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startRingtone } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "idle" | "calling" | "ringing" | "connected";
type Signal =
  | { type: "offer"; from: string; sdp: RTCSessionDescriptionInit; video: boolean }
  | { type: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; candidate: RTCIceCandidateInit }
  | { type: "end"; from: string };

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

/** Real 1:1 WebRTC call, signalled through a realtime broadcast room per conversation. */
export function useCall(conversationId: string, meId: string | undefined) {
  const [status, setStatus] = useState<Status>("idle");
  const [video, setVideo] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const pendingOffer = useRef<Signal | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const stopRingRef = useRef<(() => void) | null>(null);

  const send = useCallback(
    (payload: Signal) => channelRef.current?.send({ type: "broadcast", event: "call", payload }),
    [],
  );

  const cleanup = useCallback(() => {
    stopRingRef.current?.();
    stopRingRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingIce.current = [];
    pendingOffer.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    setStatus("idle");
  }, []);

  // Loop the ringtone while an incoming call is ringing.
  useEffect(() => {
    if (status === "ringing") {
      stopRingRef.current = startRingtone();
    } else {
      stopRingRef.current?.();
      stopRingRef.current = null;
    }
    return () => {
      stopRingRef.current?.();
      stopRingRef.current = null;
    };
  }, [status]);

  const makePeer = useCallback(
    (stream: MediaStream) => {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate && meId) send({ type: "ice", from: meId, candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? null);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setStatus("connected");
        if (pc.connectionState === "failed") {
          toast.error("Call connection failed");
          cleanup();
        }
      };
      pcRef.current = pc;
      return pc;
    },
    [meId, send, cleanup],
  );

  const getMedia = async (withVideo: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  };

  const flushIce = async () => {
    for (const c of pendingIce.current) await pcRef.current?.addIceCandidate(c).catch(() => {});
    pendingIce.current = [];
  };

  useEffect(() => {
    if (!meId) return;
    const channel = supabase.channel(`call:${conversationId}`, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "call" }, async ({ payload }) => {
        const msg = payload as Signal;
        if (msg.from === meId) return;
        if (msg.type === "offer") {
          if (pcRef.current) return;
          pendingOffer.current = msg;
          setVideo(msg.video);
          setStatus("ringing");
        } else if (msg.type === "answer") {
          await pcRef.current?.setRemoteDescription(msg.sdp);
          await flushIce();
        } else if (msg.type === "ice") {
          if (pcRef.current?.remoteDescription) await pcRef.current.addIceCandidate(msg.candidate).catch(() => {});
          else pendingIce.current.push(msg.candidate);
        } else if (msg.type === "end") {
          toast("Call ended");
          cleanup();
        }
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meId]);

  async function start(withVideo: boolean) {
    if (!meId || status !== "idle") return;
    try {
      setVideo(withVideo);
      setStatus("calling");
      const stream = await getMedia(withVideo);
      const pc = makePeer(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: "offer", from: meId, sdp: offer, video: withVideo });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not access microphone/camera");
      cleanup();
    }
  }

  async function accept() {
    const offer = pendingOffer.current;
    if (!meId || !offer || offer.type !== "offer") return;
    try {
      const stream = await getMedia(offer.video);
      const pc = makePeer(stream);
      await pc.setRemoteDescription(offer.sdp);
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: "answer", from: meId, sdp: answer });
      setStatus("connected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join call");
      end();
    }
  }

  function end() {
    if (meId) send({ type: "end", from: meId });
    cleanup();
  }

  function toggleMute() {
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted(!muted);
  }

  function toggleCamera() {
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = cameraOff));
    setCameraOff(!cameraOff);
  }

  return { status, video, muted, cameraOff, localStream, remoteStream, start, accept, end, toggleMute, toggleCamera };
}

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

export function CallOverlay({ call, title }: { call: ReturnType<typeof useCall>; title: string }) {
  if (call.status === "idle") return null;
  const label =
    call.status === "calling" ? "Calling…" : call.status === "ringing" ? `Incoming ${call.video ? "video" : "voice"} call` : "Connected";
  return (
    <div className="call-stage" role="dialog" aria-label="Call">
      {call.video && <StreamVideo stream={call.remoteStream} className="call-remote" />}
      {!call.video && <StreamVideo stream={call.remoteStream} className="hidden" />}
      <div className="call-info">
        <span className="call-pulse" />
        <h3 className="font-display text-2xl font-bold">{title}</h3>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      {call.video && call.localStream && (
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
            {call.video && (
              <Button size="icon" variant="secondary" className="call-btn" onClick={call.toggleCamera} aria-label={call.cameraOff ? "Camera on" : "Camera off"}>
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
