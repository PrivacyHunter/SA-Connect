import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPremium } from "@/lib/chat-rules";

export function usePremium(meId: string | undefined) {
  const q = useQuery({
    queryKey: ["premium", meId],
    enabled: !!meId,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("premium_access")
        .select("premium_until")
        .eq("user_id", meId!)
        .maybeSingle();
      return data?.premium_until ?? null;
    },
  });
  return { premiumUntil: q.data ?? null, premium: isPremium(q.data ?? null) };
}
