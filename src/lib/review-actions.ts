"use server";

import { updateTag } from "next/cache";
import { TAG } from "@/lib/data/tags";
import { createClient } from "@/lib/supabase/server";
import {
  draftFromForm,
  reviewViolations,
  type ReviewViolation,
} from "@/lib/review-standards";

export type ReviewError =
  | "auth"
  | "config"
  | "invalid"
  | "duplicate"
  | "cooldown"
  | "rateLimited"
  | "notFound"
  | "editClosed"
  | "rejected"
  | "generic";

export interface ReviewFormState {
  error?: ReviewError;
  violations?: ReviewViolation[];
  submitted?: boolean;
  /** Set when the success was an edit rather than a first review. */
  edited?: boolean;
}

/** `submit_review` raises one of these as its message. */
const RPC_ERRORS: Record<string, ReviewError | ReviewViolation> = {
  review_auth: "auth",
  review_invalid: "invalid",
  review_links: "links",
  review_duplicate: "duplicate",
  review_cooldown: "cooldown",
  review_rate_limited: "rateLimited",
  review_not_found: "notFound",
  review_edit_closed: "editClosed",
  review_rejected: "rejected",
};

/**
 * Submit a community review.
 *
 * SECURITY. Nothing this action decides is trusted by the database: the tier,
 * status, author name, uniqueness and rate limit are all set or enforced
 * inside `submit_review`, and there is no insert policy on `reviews` for an
 * author to go around it with. The checks here exist to give the author a
 * specific message before the round trip.
 */
export async function submitReview(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  return saveReview("submit_review", formData);
}

/**
 * Edit the author's own review of this racket.
 *
 * SECURITY. `update_review` finds the row by `auth.uid()`, not by anything
 * the form sends, and refuses once the three-day window from `created_at`
 * has closed or after staff rejected the review. The form hiding its edit
 * button past the window is display; this is the rule.
 */
export async function updateReview(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const result = await saveReview("update_review", formData);
  return result.submitted ? { ...result, edited: true } : result;
}

async function saveReview(
  rpc: "submit_review" | "update_review",
  formData: FormData,
): Promise<ReviewFormState> {
  // A field no person can see. A bot that fills every input fills this one;
  // it is told it succeeded so it learns nothing to adapt to.
  if (String(formData.get("website") ?? "") !== "") return { submitted: true };

  const draft = draftFromForm(formData);
  const violations = reviewViolations(draft);
  if (violations.length > 0) return { error: "invalid", violations };

  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "auth" };

  const { error } = await supabase.rpc(rpc, {
    p_racket_id: draft.racketId,
    p_skill_level: draft.skillLevel,
    p_format: draft.format,
    p_position: draft.position,
    p_string_model: draft.stringModel.trim(),
    p_tension_lbs: draft.tensionLbs,
    p_power: draft.power,
    p_speed: draft.speed,
    p_control: draft.control,
    p_comfort: draft.comfort,
    p_body: draft.body.trim(),
    p_locale: formData.get("locale") === "en" ? "en" : "vi",
  });

  if (error) {
    const mapped = RPC_ERRORS[error.message];
    if (mapped === "links") return { error: "invalid", violations: ["links"] };
    // A unique-index race lands here as 23505 rather than review_duplicate.
    if (error.code === "23505") return { error: "duplicate" };
    return { error: (mapped as ReviewError | undefined) ?? "generic" };
  }

  // Read-your-own-writes: the detail page's market read is tagged `reviews`.
  updateTag(TAG.reviews);
  return { submitted: true };
}
