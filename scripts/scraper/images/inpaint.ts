import { readFile, writeFile } from "node:fs/promises";
import type { EditRequest, InpaintWatermarkConfig } from "./watermark";

/**
 * Client for the local watermark remover in docker/watermark.
 *
 * The service locates a retailer's overlay by matching the templates cropped
 * from that shop's own photographs, then repaints only the matched ink with
 * LaMa. It runs on loopback with no credentials and no per-image charge, so
 * unlike the generative editor it can be pointed at the whole plan.
 *
 * Nothing here decides what a watermark is. When the service reports no
 * detection it returns the photograph unchanged and `changed: false`, and the
 * caller keeps the original bytes rather than storing a repainted copy of an
 * image that never carried an overlay.
 */
export interface Detection {
  template: string; score: number; ink: number; contrast: number;
  x: number; y: number; width: number; height: number;
}
export interface CleanResult {
  image: Uint8Array;
  changed: boolean;
  detections: Detection[];
  /** Overlay still matching where one was repainted: removal was incomplete. */
  residual: Detection[];
  maskPixels: number;
}

export interface ServiceHealth {
  ok: boolean;
  version: string;
  fingerprint: string;
  engine: string;
  lama: { loaded: boolean; error: string | null };
  templates: string[];
  sites: string[];
}

function endpoint(config: InpaintWatermarkConfig, path: string): string {
  return new URL(path, config.serviceUrl.endsWith("/") ? config.serviceUrl : `${config.serviceUrl}/`).href;
}

function headers(config: InpaintWatermarkConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
  };
}

/** Never let a service error carry the bearer token back into a log or report. */
function redact(message: string, config: InpaintWatermarkConfig): string {
  return config.apiKey ? message.replaceAll(config.apiKey, "[redacted]") : message;
}

export async function serviceHealth(config: InpaintWatermarkConfig): Promise<ServiceHealth> {
  let response: Response;
  try {
    response = await fetch(endpoint(config, "health"), {
      headers: headers(config),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `The watermark service at ${config.serviceUrl} is not reachable (${
        error instanceof Error ? redact(error.message, config) : String(error)
      }). Start it with: docker compose up -d watermark`,
    );
  }
  if (!response.ok) throw new Error(`Watermark service health check returned HTTP ${response.status}`);
  return (await response.json()) as ServiceHealth;
}

/**
 * Check the service before any Storage or database write, and pin what it is.
 *
 * The published gallery's identity includes the service version, so a
 * container built from different templates or thresholds must not quietly
 * extend a run started by another one.
 */
export async function assertInpaintReady(config: InpaintWatermarkConfig): Promise<ServiceHealth> {
  const health = await serviceHealth(config);
  if (!health.ok) throw new Error("The watermark service reported itself unhealthy");
  if (health.version !== config.version) {
    throw new Error(
      `The watermark service reports version ${health.version}, but this run is pinned to ${config.version}. ` +
        "Rebuild the image (docker compose up -d --build watermark) or set WATERMARK_SERVICE_VERSION.",
    );
  }
  if (config.fingerprint && health.fingerprint !== config.fingerprint) {
    throw new Error(
      `The watermark service fingerprint is ${health.fingerprint}, not the pinned ${config.fingerprint}. ` +
        "Its templates or thresholds have changed; unset WATERMARK_SERVICE_FINGERPRINT to accept the new one.",
    );
  }
  if (!health.templates.length) throw new Error("The watermark service has no templates loaded");
  if (health.lama.error) throw new Error(`The watermark service cannot load LaMa: ${health.lama.error}`);
  return health;
}

export async function cleanImage(
  config: InpaintWatermarkConfig,
  body: Uint8Array,
  site?: string,
): Promise<CleanResult> {
  let response: Response;
  try {
    response = await fetch(endpoint(config, "clean"), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        image: Buffer.from(body).toString("base64"),
        // Restricting to the shop the photograph came from is what keeps one
        // retailer's logo from being matched against another's artwork.
        ...(site ? { site } : {}),
        engine: config.engine,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? redact(error.message, config) : String(error);
    throw new Error(`Watermark service request failed: ${reason}`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 500);
    try {
      detail = String((JSON.parse(text) as { detail?: unknown }).detail ?? detail);
    } catch {
      // A non-JSON body is reported as it arrived.
    }
    throw new Error(`Watermark service returned HTTP ${response.status}: ${redact(detail, config)}`);
  }
  const payload = JSON.parse(text) as {
    ok: boolean;
    changed: boolean;
    image: string;
    maskPixels?: number;
    detections: Detection[];
    residual?: Detection[];
  };
  if (!payload.ok || typeof payload.image !== "string") throw new Error("Watermark service returned an unusable response");
  return {
    image: Buffer.from(payload.image, "base64"),
    changed: payload.changed === true,
    detections: payload.detections ?? [],
    residual: payload.residual ?? [],
    maskPixels: payload.maskPixels ?? 0,
  };
}

/** The EditRunner the shared cache calls; the file dance matches the CLI backend. */
export async function runInpaintService(request: EditRequest): Promise<void> {
  if (request.config.backend !== "inpaint") throw new Error("runInpaintService requires the inpaint backend");
  const result = await cleanImage(request.config, await readFile(request.input), request.site);
  await writeFile(request.output, result.image);
  await writeFile(
    request.output.replace(/\.png$/, ".detections.json"),
    JSON.stringify({
      changed: result.changed, maskPixels: result.maskPixels,
      detections: result.detections, residual: result.residual,
    }, null, 2) + "\n",
  );
}
