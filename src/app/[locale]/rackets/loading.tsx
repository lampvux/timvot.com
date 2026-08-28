import { CatalogSkeleton } from "@/components/skeletons";

/**
 * Shown during a client-side navigation into the catalogue, where the Suspense
 * boundary inside `page.tsx` does not apply — that one covers the streamed
 * first response, this one covers arriving from another route.
 *
 * Same skeleton either way, so the two paths look identical to a visitor.
 */
export default function Loading() {
  return <CatalogSkeleton />;
}
