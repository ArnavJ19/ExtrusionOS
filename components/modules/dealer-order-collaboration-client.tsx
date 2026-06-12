"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { labelize, type SessionContext } from "@/types/app";

const statuses = ["dealer_order_submitted", "accepted_by_factory", "material_reserved", "production_scheduled", "in_production", "production_completed", "quality_check_pending", "quality_check_passed", "packed", "dispatched", "in_transit", "delivered_to_dealer", "pending_dealer_count", "closed", "cancelled"];

export function DealerOrderCollaborationClient({ context, order, comments, history }: { context: SessionContext; order: any; comments: any[]; history: any[] }) {
  const router = useRouter();
  const isFactory = !context.dealerId && ["owner", "admin", "factory_manager", "production_manager", "production", "dispatch_manager", "dispatch"].includes(context.role);
  const [saving, setSaving] = useState(false);
  const [workflow, setWorkflow] = useState({ status: order.status ?? "dealer_order_submitted", factory_committed_date: order.factory_committed_date ?? "", notes: "" });
  const [comment, setComment] = useState("");

  async function updateWorkflow(clarificationRequired = false) {
    setSaving(true);
    const response = await fetch(`/api/dealer-orders/${order.id}/workflow`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...workflow, clarification_required: clarificationRequired }) });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(payload.error ?? "Could not update workflow");
    toast.success(clarificationRequired ? "Clarification task sent to dealer" : "Dealer order workflow updated");
    router.refresh();
  }

  async function addComment() {
    const response = await fetch(`/api/dealer-orders/${order.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment_text: comment, visibility: "dealer_factory" }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(payload.error ?? "Could not add comment");
    toast.success("Comment added");
    setComment("");
    router.refresh();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader><h2 className="text-lg font-bold">Factory Commitment</h2></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnly label="Current Status" value={labelize(order.status)} badge />
            <ReadOnly label="Committed ETA" value={order.factory_committed_date ?? "Not committed"} />
            <ReadOnly label="Last Factory Update" value={order.last_factory_update_at ?? "No update"} />
            <ReadOnly label="Clarification" value={order.clarification_required_at && !order.clarification_resolved_at ? "Needed" : "Not pending"} badge />
          </div>
          {isFactory ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
              <label className="block space-y-1.5"><span className="form-label">Factory status</span><select className="form-input" value={workflow.status} onChange={(event) => setWorkflow({ ...workflow, status: event.target.value })}>{statuses.map((status) => <option key={status} value={status}>{labelize(status)}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Committed ETA</span><input className="form-input" type="date" value={workflow.factory_committed_date} onChange={(event) => setWorkflow({ ...workflow, factory_committed_date: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Update notes</span><textarea className="form-input min-h-20" value={workflow.notes} onChange={(event) => setWorkflow({ ...workflow, notes: event.target.value })} /></label>
              <div className="flex flex-wrap gap-2"><Button type="button" disabled={saving} onClick={() => updateWorkflow(false)}>Update Factory Status</Button><Button type="button" variant="secondary" disabled={saving} onClick={() => updateWorkflow(true)}>Need Clarification</Button></div>
            </div>
          ) : <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">Factory progress is read-only for dealers. Production and dispatch teams update these milestones.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-lg font-bold">Dealer - Factory Thread</h2></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">{comments.map((row) => <div key={row.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><Badge value={row.created_by_role ?? "user"} /><span className="text-xs font-bold text-slate-400">{row.created_at}</span></div><p className="mt-2 text-sm font-semibold text-slate-700">{row.comment_text}</p></div>)}{!comments.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">No comments yet.</p> : null}</div>
          <label className="block space-y-1.5"><span className="form-label">Add comment</span><textarea className="form-input min-h-20" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Clarification, ETA note, dispatch instruction" /></label>
          <Button type="button" disabled={!comment.trim()} onClick={addComment}>Add Comment</Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader><h2 className="text-lg font-bold">Read-only Milestone Timeline</h2></CardHeader>
        <CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{history.map((row) => <div key={row.id} className="rounded-2xl border border-slate-200 p-4"><Badge value={row.new_status} /><p className="mt-2 text-sm font-semibold text-slate-600">{row.notes ?? "No notes"}</p><p className="mt-1 text-xs font-bold text-slate-400">{row.created_at}</p></div>)}{!history.length ? <p className="text-sm font-semibold text-slate-500">No factory milestones yet.</p> : null}</div></CardContent>
      </Card>
    </div>
  );
}

function ReadOnly({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><div className="mt-1 text-sm font-black text-slate-950">{badge ? <Badge value={value} /> : value}</div></div>;
}
