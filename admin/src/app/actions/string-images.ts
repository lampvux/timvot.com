"use server";

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { assertStaff } from "@/lib/auth";
import { thumbnailPathFor } from "@/lib/racket-image-paths";
import {
  STRING_IMAGE_BUCKET,
  stringImageSource,
  stringImageUploadPath,
} from "@/lib/string-image-paths";
import { createClient } from "@/lib/supabase/server";
import { makeThumbnail } from "@/lib/thumbnail";
import type { ContentActionState } from "./content";
import { recordAudit, revalidateStorefront } from "./mutation-utils";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const MAX_BYTES = 15 * 1024 * 1024;

async function refresh(stringId: string) {
  await revalidateStorefront("strings");
  revalidatePath("/content/strings");
  revalidatePath(`/content/strings/${encodeURIComponent(stringId)}`);
}

/** The objects a stored packshot occupies: the original and, possibly, its thumbnail. */
function objectsOf(path: string | null | undefined) {
  return path ? [path, thumbnailPathFor(path)] : [];
}

/**
 * Add or replace a string's packshot.
 *
 * Order matters for a replacement: the new objects are uploaded under new
 * keys, the row is pointed at them, and only then are the old objects
 * removed. A failure at any step leaves the string showing a complete image —
 * the old one or the new one, never a row pointing at a deleted object.
 *
 * Storage writes use the staff member's own session; the `string-images`
 * policies allow admins and managers only.
 */
export async function uploadStringImageAction(
  _previous: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const staff = await assertStaff();
  const stringId = String(formData.get("string_id") ?? "").trim();
  const file = formData.get("image_file");

  if (!stringId) return { status: "error", message: "The string is missing from the form." };
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose an image to upload.", fieldErrors: { image_file: "Choose an image to upload." } };
  }
  if (!ACCEPTED.includes(file.type) || file.size > MAX_BYTES) {
    const message = "Upload a JPEG, PNG, WebP, AVIF, or GIF no larger than 15 MB.";
    return { status: "error", message, fieldErrors: { image_file: message } };
  }

  const supabase = await createClient();
  const { data: row, error: rowError } = await supabase
    .from("strings")
    .select("id, slug, image_path, brand:brands!inner(slug)")
    .eq("id", stringId)
    .single();
  if (rowError || !row) {
    return { status: "error", message: `Could not load the string: ${rowError?.message ?? "not found"}` };
  }
  const brand = (Array.isArray(row.brand) ? row.brand[0] : row.brand) as { slug: string } | undefined;

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    const message = "The selected file is not a readable image.";
    return { status: "error", message, fieldErrors: { image_file: message } };
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const uploadId = randomUUID().slice(0, 12);
  const path = stringImageUploadPath({
    target: { brandSlug: String(brand?.slug ?? "unknown"), stringSlug: String(row.slug) },
    checksum,
    contentType: file.type,
    nonce: randomUUID().slice(0, 8),
  });
  const storage = supabase.storage.from(STRING_IMAGE_BUCKET);

  const upload = await storage.upload(path, bytes, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (upload.error) {
    return { status: "error", message: `Supabase Storage rejected the image: ${upload.error.message}` };
  }

  let thumbUrl: string | null = null;
  const thumbnail = await makeThumbnail(bytes);
  if (thumbnail) {
    const thumbPath = thumbnailPathFor(path);
    const thumbUpload = await storage.upload(thumbPath, thumbnail.data, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
    if (thumbUpload.error) {
      await storage.remove([path]);
      return { status: "error", message: `Supabase Storage rejected the thumbnail: ${thumbUpload.error.message}` };
    }
    thumbUrl = storage.getPublicUrl(thumbPath).data.publicUrl;
  }

  const imageUrl = storage.getPublicUrl(path).data.publicUrl;
  const sourceUrl = stringImageSource(String(formData.get("source_page_url") ?? ""), uploadId);
  const update = await supabase
    .from("strings")
    .update({ image_url: imageUrl, thumb_url: thumbUrl, image_path: path, image_source_url: sourceUrl })
    .eq("id", stringId);
  if (update.error) {
    await storage.remove(objectsOf(path));
    return { status: "error", message: `Could not save the image on the string: ${update.error.message}` };
  }

  const previous = row.image_path as string | null;
  if (previous && previous !== path) {
    // Best effort: a leftover object costs storage, not correctness.
    const removal = await storage.remove(objectsOf(previous));
    if (removal.error) console.error("Old string image was not removed", previous, removal.error.message);
  }

  await recordAudit(staff, previous ? "updated" : "created", "string-images", stringId, {
    image_path: path,
    replaced: previous,
    source: sourceUrl,
  });
  await refresh(stringId);
  return { status: "success", message: previous ? "Image replaced." : "Image added." };
}

/** Remove a string's packshot: clear the row, then delete the objects. */
export async function removeStringImageAction(
  _previous: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const staff = await assertStaff();
  const stringId = String(formData.get("string_id") ?? "").trim();
  if (!stringId) return { status: "error", message: "The string is missing from the form." };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("strings")
    .select("image_path")
    .eq("id", stringId)
    .single();
  if (error || !row) return { status: "error", message: `Could not load the string: ${error?.message ?? "not found"}` };

  const update = await supabase
    .from("strings")
    .update({ image_url: null, thumb_url: null, image_path: null, image_source_url: null })
    .eq("id", stringId);
  if (update.error) return { status: "error", message: `Could not remove the image: ${update.error.message}` };

  const previous = row.image_path as string | null;
  if (previous) {
    const removal = await supabase.storage.from(STRING_IMAGE_BUCKET).remove(objectsOf(previous));
    if (removal.error) console.error("String image object was not removed", previous, removal.error.message);
  }

  await recordAudit(staff, "deleted", "string-images", stringId, { image_path: previous });
  await refresh(stringId);
  return { status: "success", message: "Image removed." };
}
