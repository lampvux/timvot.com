import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { loadEnv } from "../env";
import { serviceHealth } from "./inpaint";
import { RETAILERS } from "./retailers";
import { assertWatermarkReady, watermarkConfig, WatermarkRemover, WATERMARK_PROMPT } from "./watermark";

/** Standalone edit command; the crawler uses this same WatermarkRemover directly. */
export async function removeWatermarks(args = process.argv.slice(2)) {
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    const match = arg.match(/^--(input|out|site|check|dry-run)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    flags[match[1]] = match[2] ?? true;
  }
  for (const name of ["check", "dry-run"]) if (flags[name] !== undefined && flags[name] !== true) throw new Error(`--${name} does not take a value`);
  if (flags.site !== undefined && (typeof flags.site !== "string" || !RETAILERS.includes(flags.site as never))) {
    throw new Error(`--site must be one of ${RETAILERS.join(", ")}`);
  }
  const site = typeof flags.site === "string" ? flags.site : undefined;
  loadEnv();
  const config = watermarkConfig();
  if (flags.check) {
    await assertWatermarkReady(config);
    if (config.backend === "inpaint") {
      const health = await serviceHealth(config);
      console.log(JSON.stringify({
        backend: config.backend, serviceUrl: config.serviceUrl, version: health.version,
        fingerprint: health.fingerprint, engine: health.engine, templates: health.templates,
      }, null, 2));
    } else {
      console.log("Watermark editor prerequisites are configured (API access has not been tested).");
    }
    return;
  }
  if (typeof flags.input !== "string" || !flags.input || typeof flags.out !== "string" || !flags.out) throw new Error("Use --input=<image> --out=<cleaned.png> [--site=<retailer>], or --check");
  const input = resolve(flags.input);
  const output = resolve(flags.out);
  if (input.toLowerCase() === output.toLowerCase()) throw new Error("Choose a separate output path; the original is preserved");
  if (!output.toLowerCase().endsWith(".png")) throw new Error("--out must end in .png");
  if (flags["dry-run"]) {
    console.log(JSON.stringify({
      input, output, site: site ?? null, writes: false, apiCalls: false,
      ...(config.backend === "openai"
        ? { backend: config.backend, model: config.model, quality: config.quality, prompt: WATERMARK_PROMPT }
        : { backend: config.backend, serviceUrl: config.serviceUrl, engine: config.engine, version: config.version }),
    }, null, 2));
    return;
  }
  const checked = await assertWatermarkReady(config);
  const result = await new WatermarkRemover(checked).remove(await readFile(input), site);
  await mkdir(dirname(output), { recursive: true });
  // An unchanged photograph has no cleaned file. The import keeps the original
  // bytes in that case; here --out promises a PNG, so the original is rendered
  // as one for comparison and `changed: false` says nothing was repainted.
  if (result.cleanedPath) await copyFile(result.cleanedPath, output);
  else await sharp(result.body).rotate().png().toFile(output);
  console.log(JSON.stringify({
    output, changed: result.changed, detections: result.detections,
    sourceChecksum: result.sourceChecksum, checksum: result.checksum,
    processingId: result.processingId, cached: result.cached, original: result.originalPath,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  removeWatermarks().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
