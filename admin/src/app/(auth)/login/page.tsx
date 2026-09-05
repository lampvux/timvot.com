import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { getOptionalStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const staff = await getOptionalStaff();
  if (staff) redirect("/");
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f5f7] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center"><span className="mx-auto grid size-12 place-items-center rounded-[14px] bg-[#5b37d2] text-white shadow-lg shadow-[#5b37d2]/20"><ShieldCheck aria-hidden="true" className="size-6" /></span><h1 className="mt-4 text-2xl font-bold tracking-[-0.025em]">Shuttlecraft Admin</h1><p className="mt-1.5 text-sm text-[#686470]">Sign in with an authorized staff account.</p></div>
        <div className="admin-card p-6 sm:p-7"><LoginForm /></div>
        <p className="mx-auto mt-5 max-w-sm text-center text-xs leading-5 text-[#77717e]">Access is restricted and administrative changes are recorded for operational review.</p>
      </div>
    </main>
  );
}
