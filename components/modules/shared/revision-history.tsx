"use client";

import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { formatDate } from "@/lib/utils/format";
import type { SessionContext } from "@/types/app";

type RevisionRow = {
  revision_number: number;
  actor_id: string | null;
  created_at: string;
};

export function RevisionHistory({ context, entityType, entityId }: { context: SessionContext; entityType: string; entityId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from("entity_revisions")
          .select("revision_number, actor_id, created_at")
          .eq("company_id", context.companyId)
          .eq("entity_type", entityType)
          .eq("entity_id", entityId)
          .order("revision_number", { ascending: false })
          .limit(20);
        setRevisions((data ?? []) as RevisionRow[]);
      } catch {
        // Table may not exist if migrations haven't been applied
      }
      setLoading(false);
    }
    void load();
  }, [entityId]);

  if (loading || !revisions.length) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-orange" />
          <h2 className="section-title">Revision History</h2>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {revisions.map((rev) => (
            <div key={rev.revision_number} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <span className="text-sm font-bold text-slate-700">Revision {rev.revision_number}</span>
              <span className="text-xs text-slate-500">{formatDate(rev.created_at)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
