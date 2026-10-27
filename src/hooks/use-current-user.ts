import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/types";

export function useCurrentProfile() {
  return useQuery({
    queryKey: ["me", "profile"],
    queryFn: async (): Promise<Profile | null> => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return null;
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle();
      if (error) throw error;
      return profile as Profile | null;
    },
    staleTime: 60_000,
  });
}

export function useCurrentUserId(): string | null {
  const { data } = useCurrentProfile();
  return data?.id ?? null;
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me", "profile"] });
}
