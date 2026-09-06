import type { Metadata } from "next";
import { Building2, Clock3, MapPin, Phone, Store } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SellerApplicationReviewForm } from "@/components/seller-application-review-form";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Seller applications" };

interface SellerApplication {
  id: string;
  user_id: string;
  business_type: "individual" | "business";
  business_name: string;
  contact_name: string;
  phone: string;
  city: string;
  address: string;
  tax_id: string | null;
  website_url: string | null;
  years_in_business: number;
  inventory_summary: string;
  status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}
const statusStyle = {
  pending: "bg-[#fff4d6] text-[#8a5200] ring-[#ead195]",
  approved: "bg-[#e8f8f0] text-[#067647] ring-[#a9ddc4]",
  rejected: "bg-[#fff0ee] text-[#b42318] ring-[#efc0bb]",
};

export default async function SellerApplicationsPage() {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seller_applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load seller applications: ${error.message}`);

  const applications = ((data ?? []) as SellerApplication[]).sort((a, b) => {
    const weight = { pending: 0, rejected: 1, approved: 2 };
    return weight[a.status] - weight[b.status];
  });
  const pendingCount = applications.filter((item) => item.status === "pending").length;

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Seller applications"
        description="Review applicant identity and business details. Approval creates the storefront and unlocks listing access in one transaction."
      />

      <div className="mb-4 flex items-center gap-2 text-sm text-[#686470]">
        <Clock3 aria-hidden="true" className="size-4" />
        <span>
          <strong className="text-[#37323d]">{pendingCount}</strong> waiting for review
        </span>
      </div>

      {applications.length === 0 ? (
        <div className="admin-card grid min-h-72 place-items-center p-8 text-center">
          <div>
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#eee9ff] text-[#5b37d2]">
              <Store aria-hidden="true" className="size-5" />
            </span>
            <h2 className="mt-4 font-semibold">No seller applications yet</h2>
            <p className="mt-1 text-sm text-[#686470]">
              New submissions from the storefront will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {applications.map((application) => (
            <article key={application.id} className="admin-card p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]">
                  <Building2 aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold tracking-[-0.015em]">
                      {application.business_name}
                    </h2>
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ring-1 ${statusStyle[application.status]}`}>
                      {application.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-[#686470]">
                    {application.contact_name} · {application.business_type}
                  </p>
                </div>
              </div>

              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-[#f8f8fa] px-3 py-2.5">
                  <dt className="text-xs font-semibold text-[#77717e]">Phone</dt>
                  <dd className="mt-1 flex items-center gap-2 text-[#37323d]"><Phone aria-hidden="true" className="size-3.5" />{application.phone}</dd>
                </div>
                <div className="rounded-lg bg-[#f8f8fa] px-3 py-2.5">
                  <dt className="text-xs font-semibold text-[#77717e]">Location</dt>
                  <dd className="mt-1 flex items-center gap-2 text-[#37323d]"><MapPin aria-hidden="true" className="size-3.5" />{application.city}</dd>
                </div>
                <div className="rounded-lg bg-[#f8f8fa] px-3 py-2.5 sm:col-span-2">
                  <dt className="text-xs font-semibold text-[#77717e]">Business address</dt>
                  <dd className="mt-1 text-[#37323d]">{application.address}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-[#77717e]">Years trading</dt>
                  <dd className="mt-1 text-[#37323d]">{application.years_in_business}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-[#77717e]">Tax ID</dt>
                  <dd className="mt-1 text-[#37323d]">{application.tax_id || "Not provided"}</dd>
                </div>
                {application.website_url && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-[#77717e]">Website</dt>
                    <dd className="mt-1 truncate"><a href={application.website_url} target="_blank" rel="noreferrer" className="font-medium text-[#5b37d2] hover:text-[#4423ad]">{application.website_url}</a></dd>
                  </div>
                )}
              </dl>

              <div className="mt-4 rounded-lg border border-[#e5e2e9] p-3.5">
                <p className="text-xs font-semibold text-[#77717e]">Inventory and sales plan</p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[#37323d]">
                  {application.inventory_summary}
                </p>
              </div>

              {application.review_notes && application.status !== "pending" && (
                <div className="mt-4 rounded-lg bg-[#f8f8fa] px-3.5 py-3 text-sm text-[#56515e]">
                  <strong>Review notes:</strong> {application.review_notes}
                </div>
              )}

              <p className="mt-4 text-xs text-[#8a8491]">
                Submitted {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(application.created_at))}
              </p>

              {application.status === "pending" && (
                <SellerApplicationReviewForm applicationId={application.id} />
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
