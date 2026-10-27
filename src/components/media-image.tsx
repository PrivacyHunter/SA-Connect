import { useMediaSrc } from "@/hooks/use-media-url";
import { cn } from "@/lib/utils";

interface MediaImageProps {
  bucket?: string | null | undefined;
  path?: string | null | undefined;
  alt: string;
  className?: string;
}

/** Renders an image from a storage path (resolved to a signed URL). */
export function MediaImage({ bucket, path, alt, className }: MediaImageProps) {
  const { data: src } = useMediaSrc(bucket, path);
  if (!src) return <div className={cn("animate-pulse bg-muted", className)} aria-label={alt} />;
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}

/** Signed source for a <video> element from a storage path. */
export function useVideoSrc(path: string | null | undefined, bucket = "media") {
  return useMediaSrc(path ? bucket : null, path).data ?? null;
}
