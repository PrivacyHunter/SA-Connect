import { useQuery } from "@tanstack/react-query";
import { signedUrl } from "@/lib/media";

export function useMediaSrc(
  bucket: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: ["media", bucket, path],
    queryFn: () => signedUrl(bucket as string, path as string),
    enabled: !!bucket && !!path,
    staleTime: Infinity,
    gcTime: 6 * 60 * 60 * 1000,
  });
}
