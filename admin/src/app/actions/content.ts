"use server";

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertStaff } from "@/lib/auth";
import { getCollection, type CollectionConfig, type FieldConfig } from "@/lib/collections";
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
    .eq("id", imageId);
  if (promote.error) throw promote.error;

  const updateRacket = await supabase
    .from("rackets")
    .update({ hero_image_url: publicUrl, hero_thumb_url: thumbUrl })
    .eq("id", racketId);
  if (updateRacket.error) throw updateRacket.error;
}

async function createRacketImage(
  formData: FormData,
): Promise<{ id?: string; fieldErrors: Record<string, string> }> {
  const racketId = String(formData.get("racket_id") ?? "").trim();
  const file = formData.get("image_file");
  const position = Number(formData.get("position") ?? 0);
  const isHero = formData.get("is_hero") === "on";
  const colourway = String(formData.get("colourway") ?? "").trim() || null;
  const sourcePageUrl = String(formData.get("source_page_url") ?? "").trim() || "admin-upload";

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
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
  const path = `admin/${racketId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName || "image"}`;
  const id = `img-${racketId}-${randomUUID().slice(0, 12)}`;

  const upload = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) throw upload.error;

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
    position,
    is_hero: false,
    content_type: file.type,
    bytes: file.size,
    checksum,
    colourway,
  });

  if (insert.error) {
    await supabase.storage.from(bucket).remove([path]);
    throw insert.error;
  }

  if (isHero) await setRacketHero(racketId, id, publicUrl, null);
  return { id, fieldErrors: {} };
}

async function updateRacketImage(
  id: string,
  formData: FormData,
): Promise<{ fieldErrors: Record<string, string> }> {
  const supabase = await createClient();
  const { data: current, error: loadError } = await supabase
    .from("racket_images")
    .select("id, racket_id, public_url, thumb_url, is_hero")
    .eq("id", id)
    .single();
  if (loadError) throw loadError;

  const position = Number(formData.get("position") ?? 0);
  if (!Number.isInteger(position) || position < 0) {
    return { fieldErrors: { position: "Position must be zero or greater." } };
  }

  const isHero = formData.get("is_hero") === "on";
  const update = await supabase
    .from("racket_images")
    .update({
      position,
      is_hero: false,
      colourway: String(formData.get("colourway") ?? "").trim() || null,
      source_page_url: String(formData.get("source_page_url") ?? "").trim() || "admin-upload",
    })
    .eq("id", id);
  if (update.error) throw update.error;

  if (isHero) {
    await setRacketHero(
      current.racket_id,
      id,
      current.public_url ?? "",
      current.thumb_url,
    );
  } else if (current.is_hero) {
    const reset = await supabase
      .from("rackets")
      .update({ hero_image_url: null, hero_thumb_url: null })
      .eq("id", current.racket_id);
    if (reset.error) throw reset.error;
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
        .select("racket_id, storage_bucket, storage_path, is_hero")
        .eq("id", entityId)
        .single();
      if (loadError) throw loadError;

      const removeRow = await supabase.from("racket_images").delete().eq("id", entityId);
      if (removeRow.error) throw removeRow.error;
      if (image.storage_bucket && image.storage_path) {
        await supabase.storage.from(image.storage_bucket).remove([image.storage_path]);
      }
      if (image.is_hero) {
        await supabase
          .from("rackets")
          .update({ hero_image_url: null, hero_thumb_url: null })
          .eq("id", image.racket_id);
      }
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
