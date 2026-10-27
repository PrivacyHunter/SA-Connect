import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePremium } from "@/hooks/use-premium";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";

export function BlockedUsersCard({ meId }: { meId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { premium: isPremium } = usePremium(meId);
  const blocked = useQuery({
    queryKey: ["blocked-users", meId],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_blocks").select("blocked_id, created_at").eq("blocker_id", meId).order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (data ?? []).map((b) => b.blocked_id);
      if (!ids.length) return [];
      const { data: profiles } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", ids);
      return ids.map((id) => ({ id, profile: profiles?.find((p) => p.id === id) }));
    },
  });

  async function unblock(id: string) {
    if (!isPremium) { navigate({ to: "/premium" }); return; }
    const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", meId).eq("blocked_id", id);
    if (error) return toast.error("Could not unblock");
    toast.success("Unblocked");
    qc.invalidateQueries({ queryKey: ["blocked-users", meId] });
    qc.invalidateQueries();
  }

  return (
    <section className="mx-4 mt-4 rounded-lg border border-border p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Ban className="h-4 w-4" /> Blocked accounts</h2>
      {!blocked.data?.length ? (
        <p className="mt-2 text-sm text-muted-foreground">You haven't blocked anyone.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {blocked.data.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar profile={b.profile ?? { id: b.id, display_name: "?", avatar_url: null }} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{b.profile?.display_name ?? "Unknown user"}</p>
                  {b.profile?.username && <p className="truncate text-xs text-muted-foreground">@{b.profile.username}</p>}
                </div>
              </div>
              <Button size="sm" variant={isPremium ? "secondary" : "outline"} onClick={() => unblock(b.id)}>
                {isPremium ? "Unblock" : "Unblock with Premium"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
