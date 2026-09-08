"use server";

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp, { type Metadata } from "sharp";
import { assertStaff } from "@/lib/auth";
import { getCollection, type CollectionConfig, type FieldConfig } from "@/lib/collections";
import {
  extensionForContentType,
  racketImageUploadPath,
  relocatedRacketImagePath,
  storagePathMatchesRacket,
  thumbnailPathFor,
  type RacketImagePathTarget,
} from "@/lib/racket-image-paths";
import { createClient } from "@/lib/supabase/server";
import { recordAudit, revalidateStorefront } from "./mutation-utils";

export interface ContentActionState {
  status?: "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function parseNumber(value: string, field: FieldConfig) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (field.min !== undefined && parsed < field.min) return null;
  if (field.max !== undefined && parsed > field.max) return null;
  return parsed;
}

function parseEntityData(
  collection: CollectionConfig,
  formData: FormData,
  editing: boolean,
) {
  const data: Record<string, unknown> = {};
  const fieldErrors: Record<string, string> = {};

  for (const field of collection.fields) {
    if (field.kind === "file" || (editing && field.createOnly)) continue;
    if (editing && field.readOnlyOnEdit) continue;

    if (field.kind === "boolean") {
      data[field.name] = formData.get(field.name) === "on";
      continue;
    }

    if (field.kind === "multi-select") {
      const values = formData
        .getAll(field.name)
        .map(String)
        .filter(Boolean);
      if (field.required && !values.length) fieldErrors[field.name] = `${field.label} is required.`;
      data[field.name] = values;
      continue;
    }

    const raw = String(formData.get(field.name) ?? "").trim();
    if (!raw) {
      if (field.required) fieldErrors[field.name] = `${field.label} is required.`;
      data[field.name] = field.kind === "text-list" ? [] : null;
      continue;
    }

    if (field.kind === "number") {
      const parsed = parseNumber(raw, field);
      if (parsed === null) {
        fieldErrors[field.name] = `${field.label} is outside the allowed range.`;
      } else {
        data[field.name] = parsed;
      }
    } else if (field.kind === "text-list") {
      data[field.name] = raw.split(",").map((item) => item.trim()).filter(Boolean);
    } else {
      data[field.name] = raw;
    }
  }

  if (!editing && !collection.autoKey) {
    const key = String(data[collection.primaryKey] ?? "");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
      fieldErrors[collection.primaryKey] = "Use lowercase letters, numbers, and hyphens only.";
    }
  }

  return { data, fieldErrors };
}

async function setRacketHero(
  racketId: string,
  imageId: string,
  publicUrl: string,
  thumbUrl: string | null,
) {
  const supabase = await createClient();
  const clear = await supabase
    .from("racket_images")
    .update({ is_hero: false })
    .eq("racket_id", racketId)
    .neq("id", imageId);
  if (clear.error) throw clear.error;

  const promote = await supabase
    .from("racket_images")
    .update({ is_hero: true })
    .eq("id", imageId)
    .eq("racket_id", racketId);
  if (promote.error) throw promote.error;

  const updateRacket = await supabase
    .from("rackets")
    .update({ hero_image_url: publicUrl, hero_thumb_url: thumbUrl })
    .eq("id", racketId);
  if (updateRacket.error) throw updateRacket.error;
}

async function clearRacketHero(racketId: string) {
  const supabase = await createClient();
  const clearImages = await supabase
    .from("racket_images")
    .update({ is_hero: false })
    .eq("racket_id", racketId);
  if (clearImages.error) throw clearImages.error;

  const clearRacket = await supabase
    .from("rackets")
    .update({ hero_image_url: null, hero_thumb_url: null })
    .eq("id", racketId);
  if (clearRacket.error) throw clearRacket.error;
}

async function electFallbackRacketHero(racketId: string) {
  const supabase = await createClient();
  const { data: fallback, error } = await supabase
    .from("racket_images")
    .select("id, public_url, thumb_url")
    .eq("racket_id", racketId)
    .not("public_url", "is", null)
    .order("position")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  if (!fallback?.public_url) {
    await clearRacketHero(racketId);
    return;
  }

  await setRacketHero(
    racketId,
    String(fallback.id),
    String(fallback.public_url),
    fallback.thumb_url ? String(fallback.thumb_url) : null,
  );
}

async function getRacketImagePathTarget(
  supabase: SupabaseClient,
  racketId: string,
): Promise<RacketImagePathTarget> {
  const { data: racket, error: racketError } = await supabase
    .from("rackets")
    .select("slug, brand_id")
    .eq("id", racketId)
    .single();
  if (racketError || !racket) {
    throw new Error(racketError?.message ?? "The selected racket no longer exists.");
  }

  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("slug")
    .eq("id", racket.brand_id)
    .single();
  if (brandError || !brand) {
    throw new Error(brandError?.message ?? "The selected racket has no valid brand.");
  }

  return {
    brandSlug: String(brand.slug),
    racketSlug: String(racket.slug),
  };
}

async function makeThumbnail(bytes: Buffer) {
  try {
    const { data, info } = await sharp(bytes, { failOn: "error" })
      .resize({ width: 400, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });

    if (data.byteLength >= bytes.byteLength) return null;
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

function adminSourcePageUrl(value: FormDataEntryValue | null, imageId: string) {
  const supplied = String(value ?? "").trim();
  return supplied && supplied !== "admin-upload"
    ? supplied
    : `admin-upload:${imageId}`;
}

async function ensureRacketImageThumbnail(
  supabase: SupabaseClient,
  image: { id: string; storage_bucket: string; storage_path: string },
) {
  const download = await supabase.storage
    .from(image.storage_bucket)
    .download(image.storage_path);
  if (download.error || !download.data) return null;

  const bytes = Buffer.from(await download.data.arrayBuffer());
  const thumbnail = await makeThumbnail(bytes);
  if (!thumbnail) return null;

  const thumbPath = thumbnailPathFor(image.storage_path);
  const upload = await supabase.storage
    .from(image.storage_bucket)
    .upload(thumbPath, thumbnail.data, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: true,
    });
  if (upload.error) return null;

  const thumbUrl = supabase.storage
    .from(image.storage_bucket)
    .getPublicUrl(thumbPath).data.publicUrl;
  const update = await supabase
    .from("racket_images")
    .update({ thumb_path: thumbPath, thumb_url: thumbUrl })
    .eq("id", image.id);
  if (update.error) throw update.error;

  return { thumbPath, thumbUrl };
}

async function createRacketImage(
  formData: FormData,
): Promise<{ id?: string; fieldErrors: Record<string, string> }> {
  const racketId = String(formData.get("racket_id") ?? "").trim();
  const file = formData.get("image_file");
  const position = Number(formData.get("position") ?? 0);
  const isHero = formData.get("is_hero") === "on";
  const colourway = String(formData.get("colourway") ?? "").trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!racketId) fieldErrors.racket_id = "Racket is required.";
  if (!(file instanceof File) || file.size === 0) fieldErrors.image_file = "Choose an image to upload.";
  if (file instanceof File && file.size > 15 * 1024 * 1024) fieldErrors.image_file = "The image must be 15 MB or smaller.";
  if (file instanceof File && !["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(file.type)) {
    fieldErrors.image_file = "Upload a JPEG, PNG, WebP, AVIF, or GIF image.";
  }
  if (!Number.isInteger(position) || position < 0) fieldErrors.position = "Position must be zero or greater.";
  if (Object.keys(fieldErrors).length || !(file instanceof File)) return { fieldErrors };

  const supabase = await createClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const bucket = process.env.SUPABASE_IMAGE_BUCKET || "racket-images";
  const id = `img-${racketId}-${randomUUID().slice(0, 12)}`;
  const sourcePageUrl = adminSourcePageUrl(formData.get("source_page_url"), id);
  const target = await getRacketImagePathTarget(supabase, racketId);
  const path = racketImageUploadPath({
    target,
    position,
    checksum,
    contentType: file.type,
    nonce: randomUUID().slice(0, 8),
  });

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    return { fieldErrors: { image_file: "The selected file is not a readable image." } };
  }

  const thumbnail = await makeThumbnail(bytes);
  const thumbPath = thumbnail ? thumbnailPathFor(path) : null;

  const upload = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) throw upload.error;

  let thumbUrl: string | null = null;
  if (thumbnail && thumbPath) {
    const thumbUpload = await supabase.storage.from(bucket).upload(thumbPath, thumbnail.data, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
    if (thumbUpload.error) {
      await supabase.storage.from(bucket).remove([path]);
      throw thumbUpload.error;
    }
    thumbUrl = supabase.storage.from(bucket).getPublicUrl(thumbPath).data.publicUrl;
  }

  const publicUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  const insert = await supabase.from("racket_images").insert({
    id,
    racket_id: racketId,
    provider: "admin",
    source_url: publicUrl,
    source_page_url: sourcePageUrl,
    storage_bucket: bucket,
    storage_path: path,
    public_url: publicUrl,
    thumb_path: thumbPath,
    thumb_url: thumbUrl,
    position,
    is_hero: false,
    content_type: file.type,
    bytes: file.size,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    checksum,
    colourway,
  });

  if (insert.error) {
    await supabase.storage.from(bucket).remove(
      [path, thumbPath].filter((candidate): candidate is string => Boolean(candidate)),
    );
    throw insert.error;
  }

  if (isHero) await setRacketHero(racketId, id, publicUrl, thumbUrl);
  return { id, fieldErrors: {} };
}

async function updateRacketImage(
  id: string,
  formData: FormData,
): Promise<{ fieldErrors: Record<string, string> }> {
  const supabase = await createClient();
  const { data: current, error: loadError } = await supabase
    .from("racket_images")
    .select("id, racket_id, provider, source_url, source_page_url, storage_bucket, storage_path, public_url, thumb_path, thumb_url, content_type, checksum, is_hero")
    .eq("id", id)
    .single();
  if (loadError || !current) throw loadError ?? new Error("Racket image not found.");

  const racketId = String(formData.get("racket_id") ?? "").trim();
  const position = Number(formData.get("position") ?? 0);
  if (!racketId) {
    return { fieldErrors: { racket_id: "Racket is required." } };
  }
  if (!Number.isInteger(position) || position < 0) {
    return { fieldErrors: { position: "Position must be zero or greater." } };
  }

  const target = await getRacketImagePathTarget(supabase, racketId);
  const { data: gallery, error: galleryError } = await supabase
    .from("racket_images")
    .select("id, racket_id, provider, source_url, source_page_url, storage_bucket, storage_path, public_url, thumb_path, thumb_url, content_type, checksum, is_hero")
    .eq("racket_id", current.racket_id)
    .eq("source_page_url", current.source_page_url)
    .order("position")
    .order("id");
  if (galleryError) throw galleryError;
  if (!gallery?.length) throw new Error("The image gallery no longer exists.");

  const galleryIds = new Set(gallery.map((image) => String(image.id)));
  const galleryChecksums = new Set(gallery.map((image) => String(image.checksum)));
  const { data: targetImages, error: targetImagesError } = await supabase
    .from("racket_images")
    .select("id, checksum")
    .eq("racket_id", racketId);
  if (targetImagesError) throw targetImagesError;
  const duplicate = targetImages?.find(
    (image) => !galleryIds.has(String(image.id)) && galleryChecksums.has(String(image.checksum)),
  );
  if (duplicate) {
    return {
      fieldErrors: {
        racket_id: "That racket already contains an image from this gallery. Remove the duplicate before remapping it.",
      },
    };
  }

  const plans = gallery.map((image) => {
    const fallbackName = `${image.id}.${extensionForContentType(image.content_type ?? "")}`;
    const storagePath = storagePathMatchesRacket(image.storage_path, target)
      ? image.storage_path
      : relocatedRacketImagePath(image.storage_path, target, fallbackName);
    const thumbPath = image.thumb_path ? thumbnailPathFor(storagePath) : null;
    const publicUrl = supabase.storage
      .from(image.storage_bucket)
      .getPublicUrl(storagePath).data.publicUrl;
    const thumbUrl = thumbPath
      ? supabase.storage.from(image.storage_bucket).getPublicUrl(thumbPath).data.publicUrl
      : null;
    const sourceUrl = image.provider === "admin" || image.source_url === image.public_url
      ? publicUrl
      : image.source_url;

    return {
      image,
      storagePath,
      publicUrl,
      thumbPath,
      thumbUrl,
      sourceUrl,
    };
  });
  const completedMoves: Array<{ bucket: string; from: string; to: string }> = [];

  const rollbackMoves = async () => {
    for (const move of [...completedMoves].reverse()) {
      const rollback = await supabase.storage.from(move.bucket).move(move.to, move.from);
      if (rollback.error) {
        console.error(
          `Could not roll back ${move.bucket}/${move.to}`,
          rollback.error.message,
        );
      }
    }
  };

  for (const plan of plans) {
    const moves = [
      { from: plan.image.storage_path, to: plan.storagePath },
      ...(plan.image.thumb_path && plan.thumbPath
        ? [{ from: plan.image.thumb_path, to: plan.thumbPath }]
        : []),
    ].filter((move) => move.from !== move.to);

    for (const move of moves) {
      const result = await supabase.storage
        .from(plan.image.storage_bucket)
        .move(move.from, move.to);
      if (result.error) {
        await rollbackMoves();
        throw new Error(
          `Could not move ${plan.image.storage_bucket}/${move.from} to the corrected folder: ${result.error.message}`,
        );
      }
      completedMoves.push({
        bucket: plan.image.storage_bucket,
        from: move.from,
        to: move.to,
      });
    }
  }

  const remap = await supabase.rpc("remap_racket_image_gallery", {
    p_image_id: id,
    p_target_racket_id: racketId,
    p_paths: plans.map((plan) => ({
      id: plan.image.id,
      storage_path: plan.storagePath,
      public_url: plan.publicUrl,
      thumb_path: plan.thumbPath,
      thumb_url: plan.thumbUrl,
      source_url: plan.sourceUrl,
    })),
    p_position: position,
    p_colourway: String(formData.get("colourway") ?? "").trim() || null,
    p_source_page_url: adminSourcePageUrl(formData.get("source_page_url"), id),
    p_use_as_hero: formData.get("is_hero") === "on",
  });
  if (remap.error) {
    await rollbackMoves();
    throw remap.error;
  }

  const currentPlan = plans.find((plan) => String(plan.image.id) === id);
  if (currentPlan && (!currentPlan.thumbPath || !currentPlan.thumbUrl)) {
    const generated = await ensureRacketImageThumbnail(supabase, {
      id,
      storage_bucket: currentPlan.image.storage_bucket,
      storage_path: currentPlan.storagePath,
    });
    if (generated && formData.get("is_hero") === "on") {
      await setRacketHero(racketId, id, currentPlan.publicUrl, generated.thumbUrl);
    }
  }

  return { fieldErrors: {} };
}

export async function saveEntityAction(
  _previousState: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const staff = await assertStaff();
  const collectionKey = String(formData.get("collection") ?? "");
  const collection = getCollection(collectionKey);
  const entityId = String(formData.get("entity_id") ?? "");
  const editing = Boolean(entityId);

  if (!collection) return { status: "error", message: "Unknown content type." };

  let savedId = entityId;
  try {
    if (collectionKey === "racket-images") {
      const result = editing
        ? await updateRacketImage(entityId, formData)
        : await createRacketImage(formData);
      if (Object.keys(result.fieldErrors).length) {
        return { status: "error", message: "Check the highlighted fields.", fieldErrors: result.fieldErrors };
      }
      const uploadedId = (result as { id?: string }).id;
      if (uploadedId) savedId = uploadedId;
    } else {
      const { data, fieldErrors } = parseEntityData(collection, formData, editing);
      if (Object.keys(fieldErrors).length) {
        return { status: "error", message: "Check the highlighted fields.", fieldErrors };
      }

      if (collectionKey === "offers" || collectionKey === "string-offers") {
        data.updated_at = new Date().toISOString();
      }

      const supabase = await createClient();
      const mutation = editing
        ? supabase.from(collection.table).update(data).eq(collection.primaryKey, entityId).select(collection.primaryKey).single()
        : supabase.from(collection.table).insert(data).select(collection.primaryKey).single();
      const { data: saved, error } = await mutation;
      if (error) throw error;
      savedId = String(
        (saved as unknown as Record<string, unknown>)[collection.primaryKey],
      );
    }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : `Could not save ${collection.singular}.`,
    };
  }

  await recordAudit(staff, editing ? "updated" : "created", collectionKey, savedId);
  await revalidateStorefront(collectionKey);
  revalidatePath(`/content/${collectionKey}`);
  revalidatePath(`/content/${collectionKey}/${encodeURIComponent(savedId)}`);
  redirect(`/content/${collectionKey}/${encodeURIComponent(savedId)}?saved=1`);
}

export async function setRacketHeroAction(formData: FormData) {
  const staff = await assertStaff();
  const racketId = String(formData.get("racket_id") ?? "").trim();
  const imageId = String(formData.get("image_id") ?? "").trim();
  if (!racketId || !imageId) throw new Error("A racket and gallery image are required.");

  const supabase = await createClient();
  const { data: image, error } = await supabase
    .from("racket_images")
    .select("id, racket_id, public_url, thumb_url, storage_bucket, storage_path")
    .eq("id", imageId)
    .eq("racket_id", racketId)
    .single();
  if (error || !image?.public_url) {
    throw new Error(error?.message ?? "That image is not mapped to this racket.");
  }

  let thumbUrl = image.thumb_url ? String(image.thumb_url) : null;
  if (!thumbUrl) {
    const generated = await ensureRacketImageThumbnail(supabase, {
      id: String(image.id),
      storage_bucket: String(image.storage_bucket),
      storage_path: String(image.storage_path),
    });
    thumbUrl = generated?.thumbUrl ?? null;
  }

  await setRacketHero(racketId, imageId, String(image.public_url), thumbUrl);
  await recordAudit(staff, "updated", "rackets", racketId, {
    hero_image_id: imageId,
  });
  await revalidateStorefront("racket-images");
  revalidatePath(`/content/rackets/${encodeURIComponent(racketId)}`);
  revalidatePath(`/content/racket-images/${encodeURIComponent(imageId)}`);
  redirect(`/content/rackets/${encodeURIComponent(racketId)}?saved=1`);
}

export async function deleteEntityAction(
  _previousState: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const staff = await assertStaff();
  const collectionKey = String(formData.get("collection") ?? "");
  const entityId = String(formData.get("entity_id") ?? "");
  const collection = getCollection(collectionKey);
  if (!collection || !entityId) return { status: "error", message: "Invalid delete request." };

  try {
    const supabase = await createClient();
    if (collectionKey === "racket-images") {
      const { data: image, error: loadError } = await supabase
        .from("racket_images")
        .select("racket_id, storage_bucket, storage_path, public_url, thumb_path, is_hero")
        .eq("id", entityId)
        .single();
      if (loadError) throw loadError;

      const { data: owner } = await supabase
        .from("rackets")
        .select("hero_image_url")
        .eq("id", image.racket_id)
        .maybeSingle();
      const wasHero = image.is_hero || owner?.hero_image_url === image.public_url;

      const removeRow = await supabase.from("racket_images").delete().eq("id", entityId);
      if (removeRow.error) throw removeRow.error;
      if (image.storage_bucket && image.storage_path) {
        const paths = [image.storage_path, image.thumb_path].filter(
          (candidate): candidate is string => Boolean(candidate),
        );
        const removeObjects = await supabase.storage.from(image.storage_bucket).remove(paths);
        if (removeObjects.error) {
          console.error("Could not remove deleted racket image objects", removeObjects.error.message);
        }
      }
      if (wasHero) await electFallbackRacketHero(image.racket_id);
    } else {
      const { error } = await supabase
        .from(collection.table)
        .delete()
        .eq(collection.primaryKey, entityId);
      if (error) throw error;
    }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : `Could not delete ${collection.singular}.`,
    };
  }

  await recordAudit(staff, "deleted", collectionKey, entityId);
  await revalidateStorefront(collectionKey);
  revalidatePath(`/content/${collectionKey}`);
  redirect(`/content/${collectionKey}?deleted=1`);
}
