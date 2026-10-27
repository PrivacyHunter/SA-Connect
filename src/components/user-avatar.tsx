import { useMediaSrc } from "@/hooks/use-media-url";
import { useIsOnline } from "@/lib/presence";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-20 w-20 text-2xl",
};

export function UserAvatar({
  profile,
  size = "md",
  showOnline = false,
  className,
}: {
  profile: Pick<Profile, "id" | "display_name" | "avatar_url">;
  size?: keyof typeof sizes;
  showOnline?: boolean;
  className?: string;
}) {
  const { data: src } = useMediaSrc(profile.avatar_url ? "avatars" : null, profile.avatar_url);
  const online = useIsOnline(showOnline ? profile.id : null);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-full bg-secondary font-semibold text-secondary-foreground",
          sizes[size],
        )}
      >
        {src ? (
          <img src={src} alt={profile.display_name} className="h-full w-full object-cover" />
        ) : (
          initials(profile.display_name)
        )}
      </span>
      {showOnline && (
        <span
          className={cn(
            "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background",
            online ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
      )}
    </span>
  );
}
