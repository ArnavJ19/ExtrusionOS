"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { granularPermissions } from "@/lib/auth/permissions";

type Props = {
  users: Record<string, any>[];
  roles: Record<string, any>[];
  invites: Record<string, any>[];
  dealers: Record<string, any>[];
};

export function AccessControlClient({ users, roles, invites, dealers }: Props) {
  const [active, setActive] = useState<"users" | "roles" | "invites">("users");
  return (
    <div className="space-y-6">
      <InviteUserCard roles={roles} dealers={dealers} />
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Active users" value={String(users.filter((user) => user.is_active).length)} />
        <Metric label="Roles" value={String(roles.length)} />
        <Metric label="Pending invites" value={String(invites.filter((invite) => invite.status === "pending").length)} />
        <Metric label="Dealers" value={String(dealers.length)} />
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            {(["users", "roles", "invites"] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setActive(tab)} className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${active === tab ? "bg-neutral-950 text-white" : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>{tab}</button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {active === "users" ? <UsersTable rows={users} /> : null}
          {active === "roles" ? <RolesTable rows={roles} /> : null}
          {active === "invites" ? <InvitesTable rows={invites} /> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <h2 className="text-lg font-bold text-neutral-950">Permission Matrix</h2>
            <p className="mt-1 text-sm font-medium text-neutral-500">Granular permissions are enforced by API routes and RLS policies, not only by hidden buttons.</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
            {granularPermissions.map((permission) => <div key={permission} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-700">{permission}</div>)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InviteUserCard({ roles, dealers }: { roles: Record<string, any>[]; dealers: Record<string, any>[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const activeRoles = roles.filter((role) => role.is_active !== false);
  const activeDealers = dealers.filter((dealer) => dealer.is_active !== false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const dealerId = String(form.get("dealer_id") || "");
    setLoading(true);
    const response = await fetch("/api/access/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        full_name: String(form.get("full_name") || ""),
        email: String(form.get("email") || ""),
        phone: String(form.get("phone") || "") || undefined,
        role_id: String(form.get("role_id") || ""),
        dealer_id: dealerId || null,
        sales_region: String(form.get("sales_region") || "") || null,
        department: String(form.get("department") || "") || null,
        expires_in_days: 7
      })
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) return toast.error(payload.error ?? "Could not send invite");
    if (payload.email?.success === false) {
      toast.warning(`Invite created, but email was not sent: ${payload.email.error}`);
    } else {
      toast.success("Invite sent");
    }
    formElement.reset();
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <h2 className="text-lg font-bold text-neutral-950">Invite User</h2>
          <p className="mt-1 text-sm font-medium text-neutral-500">Send an employee or dealer user a secure 7-day invite link.</p>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 lg:grid-cols-6">
          <label className="block space-y-1.5 lg:col-span-2"><span className="form-label">Name</span><input className="form-input" name="full_name" required placeholder="Team member name" /></label>
          <label className="block space-y-1.5 lg:col-span-2"><span className="form-label">Email</span><input className="form-input" name="email" type="email" required placeholder="name@company.com" /></label>
          <label className="block space-y-1.5 lg:col-span-2"><span className="form-label">Phone optional</span><input className="form-input" name="phone" /></label>
          <label className="block space-y-1.5 lg:col-span-2"><span className="form-label">Role</span><select className="form-input" name="role_id" required><option value="">Select role</option>{activeRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label className="block space-y-1.5 lg:col-span-2"><span className="form-label">Dealer optional</span><select className="form-input" name="dealer_id"><option value="">Factory / company user</option>{activeDealers.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.dealer_name}</option>)}</select></label>
          <label className="block space-y-1.5"><span className="form-label">Region</span><input className="form-input" name="sales_region" placeholder="West" /></label>
          <label className="block space-y-1.5"><span className="form-label">Department</span><input className="form-input" name="department" placeholder="Sales" /></label>
          <div className="flex items-end lg:col-span-6"><Button disabled={loading || !activeRoles.length} type="submit">{loading ? "Sending..." : "Send invite"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function UsersTable({ rows }: { rows: Record<string, any>[] }) {
  return <Table columns={["User", "Role", "Dealer", "Status"]} rows={rows} render={(row) => [row.full_name || row.email || "User", <Badge key="role" value={row.role ?? "viewer"} />, row.dealers?.dealer_name ?? "Factory", <Badge key="status" value={row.is_active ? "active" : "deactivated"} />]} />;
}

function RolesTable({ rows }: { rows: Record<string, any>[] }) {
  return <Table columns={["Role", "Key", "Type", "Status"]} rows={rows} render={(row) => [row.name, row.role_key, row.is_system ? "Default" : "Custom", <Badge key="status" value={row.is_active ? "active" : "inactive"} />]} />;
}

function InvitesTable({ rows }: { rows: Record<string, any>[] }) {
  return <Table columns={["Invitee", "Email", "Dealer", "Status"]} rows={rows} render={(row) => [row.full_name, row.email, row.dealers?.dealer_name ?? "Factory", <Badge key="status" value={row.status ?? "pending"} />]} />;
}

function Table({ columns, rows, render }: { columns: string[]; rows: Record<string, any>[]; render: (row: Record<string, any>) => React.ReactNode[] }) {
  return <div className="overflow-x-auto"><table className="industrial-table min-w-[760px]"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{render(row).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}{!rows.length ? <tr><td colSpan={columns.length} className="px-4 py-12 text-center font-semibold text-neutral-500">No records found.</td></tr> : null}</tbody></table></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">{label}</p><p className="mt-2 text-2xl font-black text-neutral-950">{value}</p></CardContent></Card>;
}
