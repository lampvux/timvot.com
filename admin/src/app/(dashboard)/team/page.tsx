import type { Metadata } from "next";
import { ShieldCheck, ShieldMinus, UserRoundCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StaffCreateForm } from "@/components/staff-create-form";
import { setStaffActiveAction, updateStaffRoleAction } from "@/app/actions/staff";
import { getStaffMembers } from "@/lib/staff";

export const metadata: Metadata = { title: "Staff access" };

export default async function TeamPage() {
  const members = await getStaffMembers();
  return (
    <>
      <PageHeader eyebrow="Administration" title="Staff access" description="Create administrators and content managers, review access, and deactivate accounts without deleting their audit history." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="admin-card overflow-hidden"><div className="border-b border-[#e5e2e9] px-5 py-4"><h2 className="font-semibold">Active staff directory</h2><p className="mt-1 text-xs text-[#77717e]">{members.length} account{members.length === 1 ? "" : "s"} with admin access</p></div><div className="divide-y divide-[#ebe9ee]">{members.map((member) => (
          <article key={member.id} className="p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><span className={`grid size-10 shrink-0 place-items-center rounded-full ${member.active ? "bg-[#e8f8f0] text-[#067647]" : "bg-[#f2f0f4] text-[#77717e]"}`}>{member.active ? <UserRoundCheck aria-hidden="true" className="size-5" /> : <ShieldMinus aria-hidden="true" className="size-5" />}</span><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{member.displayName}</h3><p className="truncate text-xs text-[#686470]">{member.email}</p><p className="mt-1 text-xs text-[#8a8491]">Last sign-in: {member.lastSignInAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(member.lastSignInAt)) : "Never"}</p></div><div className="flex flex-wrap gap-2">
            <form action={updateStaffRoleAction} className="flex gap-2"><input type="hidden" name="user_id" value={member.id} /><label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.displayName}</label><select id={`role-${member.id}`} name="role" defaultValue={member.role} className="field-control min-h-10 w-32 py-1.5 text-sm"><option value="manager">Manager</option><option value="admin">Admin</option></select><button type="submit" className="button-secondary min-h-10 py-1.5">Update</button></form>
            <form action={setStaffActiveAction}><input type="hidden" name="user_id" value={member.id} /><input type="hidden" name="active" value={String(!member.active)} /><button type="submit" className={member.active ? "button-danger min-h-10 py-1.5" : "button-secondary min-h-10 py-1.5"}>{member.active ? "Deactivate" : "Reactivate"}</button></form>
          </div></div></article>
        ))}</div></section>
        <aside className="admin-card p-5 sm:p-6"><div className="mb-5 flex gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]"><ShieldCheck aria-hidden="true" className="size-5" /></span><div><h2 className="font-semibold">Add staff member</h2><p className="mt-0.5 text-xs leading-5 text-[#686470]">The account is email-confirmed and can sign in immediately.</p></div></div><StaffCreateForm /></aside>
      </div>
    </>
  );
}
