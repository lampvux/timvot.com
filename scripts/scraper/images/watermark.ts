import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { assertInpaintReady, runInpaintService } from "./inpaint";
import { extensionFor, sha256, sniffContentType } from "./storage";

const execFileAsync = promisify(execFile);
export const WATERMARK_PROMPT = `Use case: precise-object-edit.
Input image: edit target, a photograph used in a badminton racket product gallery.
Remove only overlaid retailer watermarks, shop logos, website addresses and promotional text added on top of the photograph. Reconstruct only the small areas those overlays cover.
Keep the photographed racket exactly the same: frame shape and geometry, shaft, string pattern, grip, manufacturer logos, model names printed on the racket, serial markings, colours, decals, paintwork, materials and proportions. Manufacturer marks physically printed on the product are NOT watermarks and must remain legible and unchanged.
Keep the original framing, aspect ratio, background, shadows, lighting, resolution detail and every other object. Do not crop, recompose, beautify, repaint, replace or invent any product detail. If there is no overlaid watermark, return the photograph without visual changes. Output the edited photograph only.`;

/**
 * Two backends remove the same thing by different means.
 *
 * `inpaint` is the local service in docker/watermark: it matches each shop's
 * overlay against templates cropped from that shop's own photographs and
 * repaints only the matched ink with LaMa. It is free, offline, and it
 * reports when it found nothing, so an unstamped photograph is left alone.
 *
 * `openai` is the original generative editor. It rewrites the whole image
 * through a model and charges per call, so it stays available for a frame the
 * templates do not cover but is no longer the default.
 */
export type WatermarkBackend = "inpaint" | "openai";

export interface OpenAIWatermarkConfig {
  backend: "openai";
  python: string;
  cli: string;
  cacheDir: string;
  model: "gpt-image-2";
  quality: "high";
}
export interface InpaintWatermarkConfig {
  backend: "inpaint";
  serviceUrl: string;
  apiKey: string | null;
  cacheDir: string;
  engine: "lama";
  /** Pinned image version; the service is refused if it reports another. */
  version: string;
  /** Optional stricter pin over templates and thresholds as well. */
  fingerprint: string | null;
  timeoutMs: number;
}
export type WatermarkConfig = OpenAIWatermarkConfig | InpaintWatermarkConfig;

export interface WatermarkEdit {
  body: Uint8Array;
  contentType: string;
  checksum: string;
  sourceChecksum: string;
  width: number;
  height: number;
  originalPath: string;
  cleanedPath: string | null;
  processingId: string;
  /** False when the remover found no overlay; the original bytes are kept. */
  changed: boolean;
  detections: number;
  /** Overlay still matching where one was repainted: removal was incomplete. */
  residual: number;
  cached: boolean;
}
interface CacheRecord extends Omit<WatermarkEdit, "body" | "cached"> {
  version: 2;
  site: string | null;
}
export interface EditRequest {
  input: string;
  output: string;
  promptFile: string;
  config: WatermarkConfig;
  /** The retailer the photograph came from, when known. */
  site?: string;
}
export type EditRunner = (request: EditRequest) => Promise<void>;

export const DEFAULT_SERVICE_URL = "http://127.0.0.1:8770";
export const DEFAULT_SERVICE_VERSION = "1.0.0";

export function watermarkConfig(env: Readonly<Record<string, string | undefined>> = process.env): WatermarkConfig {
  const cacheDir = resolve(env.WATERMARK_CACHE_DIR || "scripts/scraper/output/watermarks");
  if ((env.WATERMARK_BACKEND || "inpaint") !== "openai") {
    return {
      backend: "inpaint",
      serviceUrl: env.WATERMARK_SERVICE_URL || DEFAULT_SERVICE_URL,
      apiKey: env.WATERMARK_SERVICE_API_KEY?.trim() || null,
      cacheDir,
      engine: "lama",
      version: env.WATERMARK_SERVICE_VERSION || DEFAULT_SERVICE_VERSION,
      fingerprint: env.WATERMARK_SERVICE_FINGERPRINT?.trim() || null,
      timeoutMs: Number(env.WATERMARK_TIMEOUT_MS) > 0 ? Number(env.WATERMARK_TIMEOUT_MS) : 5 * 60_000,
    };
  }
  const userHome = homedir();
  const projectPython = resolve(".venv-watermarks", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const bundledPython = join(userHome, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
  return {
    backend: "openai",
    python: env.WATERMARK_PYTHON || (existsSync(projectPython) ? projectPython : existsSync(bundledPython) ? bundledPython : "python"),
    cli: env.IMAGE_GEN_CLI || join(env.CODEX_HOME || join(userHome, ".codex"), "skills", ".system", "imagegen", "scripts", "image_gen.py"),
    cacheDir,
    model: "gpt-image-2", quality: "high",
  };
}

/** Identity of one processing configuration; galleries from different ones never mix. */
export function watermarkProcessingId(config: WatermarkConfig): string {
  const descriptor = config.backend === "openai"
    ? { backend: "openai", model: config.model, quality: config.quality, prompt: WATERMARK_PROMPT }
    : { backend: "inpaint", engine: config.engine, version: config.version, fingerprint: config.fingerprint };
  return `watermark-v2-${sha256(Buffer.from(JSON.stringify(descriptor))).slice(0, 16)}`;
}

export function watermarkCliArgs(request: EditRequest, dryRun = false): string[] {
  if (request.config.backend !== "openai") throw new Error("watermarkCliArgs is only for the openai backend");
  return [request.config.cli, "edit", "--model", request.config.model,
    "--image", request.input, "--prompt-file", request.promptFile,
    "--quality", request.config.quality, "--size", "auto", "--output-format", "png",
    "--out", request.output, "--no-augment", ...(dryRun ? ["--dry-run"] : [])];
}

/**
 * Check prerequisites before any Storage or database write, and return a
 * config whose identity matches the remover that will actually run.
 *
 * For the service that means adopting its live fingerprint when none was
 * pinned, so the processing id follows its templates and thresholds. Without
 * that, editing a threshold would leave the id unchanged and a cached result
 * from the previous settings would be reused as though nothing had moved.
 *
 * Never print key values.
 */
export async function assertWatermarkReady(config: WatermarkConfig, env: Readonly<Record<string, string | undefined>> = process.env): Promise<WatermarkConfig> {
  if (config.backend === "inpaint") {
    const health = await assertInpaintReady(config);
    return { ...config, fingerprint: config.fingerprint ?? health.fingerprint };
  }
  if (!env.OPENAI_API_KEY?.trim()) throw new Error("Watermark removal requires OPENAI_API_KEY in .env.local or the environment. No images were uploaded. Do not paste the key in chat.");
  if (!existsSync(config.cli)) throw new Error("The bundled imagegen CLI was not found. Set IMAGE_GEN_CLI to image_gen.py.");
  try {
    await execFileAsync(config.python, ["-c", "import openai"], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
  } catch {
    throw new Error("Watermark removal needs Python with the openai package. Set WATERMARK_PYTHON to that interpreter.");
  }
  return config;
}

export async function runWatermarkCli(request: EditRequest): Promise<void> {
  // The reusable wrapper uses the installed imagegen CLI unchanged. Shell
  // expansion is disabled and neither the prompt nor credentials enter a command string.
  if (request.config.backend !== "openai") throw new Error("runWatermarkCli requires the openai backend");
  try {
    await execFileAsync(request.config.python, watermarkCliArgs(request), {
      windowsHide: true, timeout: 10 * 60_000, maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const details = error as { stderr?: string; code?: string | number; killed?: boolean };
    let message = details.stderr?.trim().slice(-1500) || (details.killed ? "Image edit timed out" : `Image editor failed (${details.code ?? "unknown error"})`);
    if (process.env.OPENAI_API_KEY) message = message.replaceAll(process.env.OPENAI_API_KEY, "[redacted]");
    message = message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
    throw new Error(message);
  }
}

/** The runner each backend uses when the caller does not inject one. */
export function defaultRunner(config: WatermarkConfig): EditRunner {
  return config.backend === "inpaint" ? runInpaintService : runWatermarkCli;
}

async function dimensions(body: Uint8Array) {
  if (body.length > 15 * 1024 * 1024) throw new Error("Edited image exceeds the 15 MB storage limit");
  const image = sharp(body, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height < 40_000) throw new Error("Image is undecodable or smaller than 40,000 pixels");
  await image.resize(8, 8).raw().toBuffer();
  const rotated = (metadata.orientation ?? 1) >= 5;
  return { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height };
}

export class WatermarkRemover {
  readonly processingId: string;
  private readonly run: EditRunner;
  private readonly pending = new Map<string, Promise<WatermarkEdit>>();

  constructor(private readonly config: WatermarkConfig, run?: EditRunner) {
    this.processingId = watermarkProcessingId(config);
    this.run = run ?? defaultRunner(config);
  }

  /**
   * Content-based cache and in-flight dedupe avoid processing the same source
   * twice. The site is part of the key because it selects which shop's
   * templates the remover is allowed to match.
   */
  remove(body: Uint8Array, site?: string): Promise<WatermarkEdit> {
    const sourceChecksum = sha256(body);
    const key = `${site ?? "any"}/${sourceChecksum}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = this.process(body, sourceChecksum, site);
    this.pending.set(key, work);
    void work.finally(() => this.pending.delete(key)).catch(() => {});
    return work;
  }

  private async process(body: Uint8Array, sourceChecksum: string, site?: string): Promise<WatermarkEdit> {
    const type = sniffContentType(body, "");
    if (!type) throw new Error("Watermark input is not a supported raster image");
    const sourceSize = await dimensions(body);
    const originalPath = join(this.config.cacheDir, "originals", `${sourceChecksum}.${extensionFor(type)}`);
    const directory = join(this.config.cacheDir, this.processingId, site ?? "any", sourceChecksum);
    const cleanedPath = join(directory, "cleaned.png");
    const recordPath = join(directory, "edit.json");
    await mkdir(dirname(originalPath), { recursive: true });
    if (!existsSync(originalPath)) await writeFile(originalPath, body, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    if (sha256(await readFile(originalPath)) !== sourceChecksum) throw new Error("Archived original checksum mismatch");
    if (existsSync(recordPath)) {
      const record = JSON.parse(await readFile(recordPath, "utf8")) as CacheRecord;
      if (record.version !== 2 || record.sourceChecksum !== sourceChecksum || record.processingId !== this.processingId || (record.site ?? null) !== (site ?? null)) {
        throw new Error("Watermark cache checksum/configuration mismatch; inspect this cache before retrying");
      }
      if (!record.changed) {
        // Verified as carrying no overlay: the original is what gets published.
        if (record.checksum !== sourceChecksum) throw new Error("Watermark cache checksum/configuration mismatch; inspect this cache before retrying");
        return { ...record, cleanedPath: null, body, contentType: type, cached: true };
      }
      const cached = await readFile(cleanedPath);
      if (record.checksum !== sha256(cached)) throw new Error("Watermark cache checksum/configuration mismatch; inspect this cache before retrying");
      const size = await dimensions(cached);
      if (size.width !== record.width || size.height !== record.height || sniffContentType(cached, "") !== "image/png") throw new Error("Invalid cached watermark edit");
      return { ...record, originalPath, cleanedPath, body: cached, contentType: "image/png", cached: true };
    }
    await mkdir(directory, { recursive: true });
    // Normalize the API input format while archiving the exact original above.
    const input = join(directory, "input.png");
    const output = join(directory, "pending.png");
    const promptFile = join(directory, "prompt.txt");
    const detectionsPath = output.replace(/\.png$/, ".detections.json");
    await sharp(body).rotate().png().toFile(input);
    await writeFile(promptFile, WATERMARK_PROMPT);
    // A timed-out/crashed edit can leave a partial file; never treat it as a cache hit.
    await rm(output, { force: true });
    await rm(detectionsPath, { force: true });
    console.log(`   removing retailer watermark: ${sourceChecksum.slice(0, 12)}${site ? ` (${site})` : ""}`);
    await this.run({ input, output, promptFile, config: this.config, site });
    const edited = await readFile(output);
    if (sniffContentType(edited, "") !== "image/png") throw new Error("Watermark editor did not produce a PNG");
    const size = await dimensions(edited);
    const aspectChange = Math.abs((size.width / size.height) / (sourceSize.width / sourceSize.height) - 1);
    if (aspectChange > 0.03) throw new Error("Watermark edit changed framing/aspect ratio by more than 3%; not uploading it");

    // A remover that reports "no overlay here" is giving a verified answer,
    // not failing: keep the original bytes rather than publishing a re-encoded
    // copy of a photograph nothing was removed from. A *failed* edit still
    // throws above and never reaches this point.
    const found = existsSync(detectionsPath)
      ? (JSON.parse(await readFile(detectionsPath, "utf8")) as { changed?: boolean; detections?: unknown[]; residual?: unknown[] })
      : null;
    const changed = found ? found.changed === true : true;
    const detections = found?.detections?.length ?? (changed ? 1 : 0);
    const residual = found?.residual?.length ?? 0;
    if (residual) console.warn(`   incomplete removal on ${sourceChecksum.slice(0, 12)}: ${residual} overlay match(es) survived`);

    const record: CacheRecord = {
      version: 2, site: site ?? null, sourceChecksum, processingId: this.processingId,
      changed, detections, residual, originalPath,
      ...(changed
        ? { checksum: sha256(edited), contentType: "image/png", cleanedPath, ...size }
        : { checksum: sourceChecksum, contentType: type, cleanedPath: null, ...sourceSize }),
    };
    if (changed) await rename(output, cleanedPath);
    else await rm(output, { force: true });
    await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");
    return { ...record, body: changed ? edited : body, cached: false };
  }
}
