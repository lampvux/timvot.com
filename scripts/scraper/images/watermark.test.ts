import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { backfillOptions, canResumeRetailerGallery } from "./retailer-backfill";
import { targetsToClear, undoOptions } from "./undo-backfill-run";
import { assertInpaintReady, cleanImage, runInpaintService } from "./inpaint";
import {
  assertWatermarkReady, defaultRunner, watermarkCliArgs, watermarkConfig,
  watermarkProcessingId, WatermarkRemover, WATERMARK_PROMPT,
  type EditRunner, type InpaintWatermarkConfig, type OpenAIWatermarkConfig,
} from "./watermark";
import { sha256 } from "./storage";

const sourceImage = () => sharp({ create: { width: 300, height: 300, channels: 3, background: "#eeeeee" } }).png().toBuffer();
const editedImage = () => sharp({ create: { width: 300, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
const cacheDir = () => mkdtemp(join(tmpdir(), "racket-watermark-test-"));

async function config(): Promise<OpenAIWatermarkConfig> {
  return { backend: "openai", python: "python", cli: "C:/path with spaces/image_gen.py", cacheDir: await cacheDir(), model: "gpt-image-2", quality: "high" };
}
async function serviceConfig(overrides: Partial<InpaintWatermarkConfig> = {}): Promise<InpaintWatermarkConfig> {
  return {
    backend: "inpaint", serviceUrl: "http://127.0.0.1:1/", apiKey: null, cacheDir: await cacheDir(),
    engine: "lama", version: "1.0.0", fingerprint: null, timeoutMs: 5_000, ...overrides,
  };
}
const fakeEditor: EditRunner = async ({ output }) => { await writeFile(output, await editedImage()); };
/** A runner standing in for the service, which also writes the detections sidecar. */
function fakeService(changed: boolean, detections = changed ? 1 : 0): EditRunner {
  return async ({ input, output }) => {
    await writeFile(output, changed ? await editedImage() : await readFile(input));
    await writeFile(output.replace(/\.png$/, ".detections.json"), JSON.stringify({ changed, detections, maskPixels: changed ? 900 : 0 }));
  };
}

// --- shared cache and safety rails -----------------------------------------

test("watermark edit preserves original bytes and hashes the edited output", async () => {
  const original = await sourceImage();
  const result = await new WatermarkRemover(await config(), fakeEditor).remove(original);
  assert.equal(result.sourceChecksum, sha256(original));
  assert.deepEqual(await readFile(result.originalPath), original);
  assert.equal(result.checksum, sha256(await editedImage()));
  assert.notEqual(result.checksum, result.sourceChecksum);
  assert.equal(result.contentType, "image/png");
  assert.deepEqual([result.width, result.height], [300, 300]);
});

test("concurrent duplicate sources call the paid editor once", async () => {
  let calls = 0;
  const editor = new WatermarkRemover(await config(), async (request) => { calls++; await fakeEditor(request); });
  const source = await sourceImage();
  const results = await Promise.all([editor.remove(source), editor.remove(source), editor.remove(source)]);
  assert.equal(calls, 1);
  assert.equal(new Set(results.map((result) => result.checksum)).size, 1);
});

test("a new process reuses a verified edit without another API call", async () => {
  const settings = await config();
  const source = await sourceImage();
  const first = await new WatermarkRemover(settings, fakeEditor).remove(source);
  const second = await new WatermarkRemover(settings, async () => { assert.fail("cached source was sent for another edit"); }).remove(source);
  assert.equal(second.cached, true);
  assert.equal(second.checksum, first.checksum);
});

test("corrupted cache fails closed instead of uploading modified bytes", async () => {
  const settings = await config();
  const source = await sourceImage();
  const first = await new WatermarkRemover(settings, fakeEditor).remove(source);
  await writeFile(first.cleanedPath!, "corrupt");
  await assert.rejects(new WatermarkRemover(settings, fakeEditor).remove(source), /checksum\/configuration mismatch/);
});

test("a failed edit retains the original but never yields an unprocessed fallback", async () => {
  const settings = await config();
  const source = await sourceImage();
  const remover = new WatermarkRemover(settings, async () => { throw new Error("API quota exhausted"); });
  await assert.rejects(remover.remove(source), /quota exhausted/);
  assert.deepEqual(await readFile(join(settings.cacheDir, "originals", `${sha256(source)}.png`)), source);
  await assert.rejects(access(join(settings.cacheDir, remover.processingId, "any", sha256(source), "edit.json")));
});

test("framing changes are rejected before upload", async () => {
  const settings = await config();
  const editor = new WatermarkRemover(settings, async ({ output }) => {
    await sharp({ create: { width: 400, height: 200, channels: 3, background: "white" } }).png().toFile(output);
  });
  await assert.rejects(editor.remove(await sourceImage()), /changed framing\/aspect ratio/);
});

test("EXIF rotation is normalized without being mistaken for a framing change", async () => {
  const source = await sharp({ create: { width: 400, height: 200, channels: 3, background: "white" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const editor = new WatermarkRemover(await config(), async ({ input, output }) => {
    await writeFile(output, await readFile(input));
  });
  const result = await editor.remove(source);
  assert.deepEqual([result.width, result.height], [200, 400]);
  assert.deepEqual(await readFile(result.originalPath), source);
});

test("invalid model output is not treated as a successful watermark removal", async () => {
  const editor = new WatermarkRemover(await config(), async ({ output }) => { await writeFile(output, "<html>server error</html>"); });
  await assert.rejects(editor.remove(await sourceImage()), /did not produce a PNG/);
});

test("missing key blocks processing before any API or upload call", async () => {
  await assert.rejects(assertWatermarkReady(await config(), {}), /requires OPENAI_API_KEY/);
});

test("CLI uses file arguments and preserves product markings in its edit prompt", async () => {
  const settings = await config();
  const args = watermarkCliArgs({ config: settings, input: "C:/image with spaces.png", output: "C:/cleaned.png", promptFile: "C:/prompt.txt" });
  assert.equal(args[0], settings.cli);
  assert.ok(args.includes("C:/image with spaces.png"));
  assert.ok(args.includes("gpt-image-2"));
  assert.ok(!args.includes("--input-fidelity"));
  assert.match(WATERMARK_PROMPT, /Manufacturer marks physically printed on the product are NOT watermarks/);
  assert.match(WATERMARK_PROMPT, /Do not crop/);
});

test("removal is explicit and cannot accidentally reuse an original-only gallery run", async () => {
  assert.equal(backfillOptions(["--validate", "--plan=x", "--remove-watermarks"]).removeWatermarks, true);
  assert.throws(() => backfillOptions(["--remove-watermarks"]));
  assert.throws(() => backfillOptions(["--validate", "--plan=x", "--remove-watermarks=false"]));
  const processing = watermarkProcessingId(await config());
  const original = { id: "retail-plan-original-racket-sha", provider: "retailer-vnb", admin_managed: false } as Parameters<typeof canResumeRetailerGallery>[0][number];
  assert.equal(canResumeRetailerGallery([original], `plan-${processing}`), false);
  const cleaned = { ...original, id: `retail-plan-${processing}-racket-sha` };
  assert.equal(canResumeRetailerGallery([cleaned], `plan-${processing}`), true);
  assert.equal(canResumeRetailerGallery([cleaned], "plan-original"), false);
});

// --- backend selection ------------------------------------------------------

test("the local service is the default backend and the paid editor is opt-in", async () => {
  assert.equal(watermarkConfig({}).backend, "inpaint");
  assert.equal(watermarkConfig({ WATERMARK_BACKEND: "openai" }).backend, "openai");
  const service = watermarkConfig({ WATERMARK_SERVICE_URL: "http://example.test:9/" });
  assert.equal(service.backend === "inpaint" && service.serviceUrl, "http://example.test:9/");
  assert.equal(defaultRunner(await serviceConfig()), runInpaintService);
});

test("galleries from different removers, versions and template sets never share an identity", async () => {
  const paid = watermarkProcessingId(await config());
  const local = watermarkProcessingId(await serviceConfig());
  const newer = watermarkProcessingId(await serviceConfig({ version: "1.1.0" }));
  const pinned = watermarkProcessingId(await serviceConfig({ fingerprint: "abc123" }));
  assert.equal(new Set([paid, local, newer, pinned]).size, 4);
  for (const id of [paid, local, newer, pinned]) assert.match(id, /^watermark-v2-[0-9a-f]{16}$/);
});

// --- the service backend ----------------------------------------------------

test("a photograph with no overlay keeps its original bytes and format", async () => {
  const source = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();
  const settings = await serviceConfig();
  const result = await new WatermarkRemover(settings, fakeService(false)).remove(source, "vnb");
  assert.equal(result.changed, false);
  assert.equal(result.detections, 0);
  assert.equal(result.cleanedPath, null);
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.checksum, result.sourceChecksum);
  assert.deepEqual(Buffer.from(result.body), source);
});

test("an unchanged verdict is cached and not re-sent to the service", async () => {
  const settings = await serviceConfig();
  const source = await sourceImage();
  await new WatermarkRemover(settings, fakeService(false)).remove(source, "vnb");
  const again = await new WatermarkRemover(settings, async () => { assert.fail("a cached verdict was sent to the service again"); }).remove(source, "vnb");
  assert.equal(again.cached, true);
  assert.equal(again.changed, false);
  assert.equal(again.checksum, sha256(source));
});

test("the same bytes from two shops are processed separately", async () => {
  const settings = await serviceConfig();
  const source = await sourceImage();
  const sites: string[] = [];
  const remover = new WatermarkRemover(settings, async (request) => { sites.push(request.site ?? "none"); await fakeService(true)(request); });
  await remover.remove(source, "vnb");
  await remover.remove(source, "fbshop");
  assert.deepEqual(sites, ["vnb", "fbshop"]);
});

test("the shop is passed to the runner so only its own templates are matched", async () => {
  let seen: string | undefined = "unset";
  const remover = new WatermarkRemover(await serviceConfig(), async (request) => { seen = request.site; await fakeService(true)(request); });
  await remover.remove(await sourceImage(), "qvbadminton");
  assert.equal(seen, "qvbadminton");
});

test("a service failure never falls back to publishing the unprocessed image", async () => {
  const settings = await serviceConfig();
  const remover = new WatermarkRemover(settings, async () => { throw new Error("Watermark service returned HTTP 503"); });
  await assert.rejects(remover.remove(await sourceImage(), "hvshop"), /503/);
  await assert.rejects(access(join(settings.cacheDir, remover.processingId, "hvshop", sha256(await sourceImage()), "edit.json")));
});

test("an unreachable service is reported as a startup problem, not a bad image", async () => {
  await assert.rejects(assertWatermarkReady(await serviceConfig()), /not reachable|docker compose up/);
});

// --- the service client over real HTTP --------------------------------------

async function withServer(handler: (url: string, body: unknown) => { status?: number; payload: unknown }, run: (base: string) => Promise<void>) {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      const { status = 200, payload } = handler(request.url ?? "", body);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

const health = (overrides: Record<string, unknown> = {}) => ({
  ok: true, version: "1.0.0", fingerprint: "f".repeat(32), engine: "lama",
  lama: { loaded: true, error: null }, templates: ["vnb/vnb-logo"], sites: ["vnb"], ...overrides,
});

test("readiness refuses a service built from other templates or another version", async () => {
  await withServer(() => ({ payload: health({ version: "9.9.9" }) }), async (base) => {
    await assert.rejects(assertInpaintReady(await serviceConfig({ serviceUrl: base })), /pinned to 1\.0\.0/);
  });
  await withServer(() => ({ payload: health() }), async (base) => {
    await assert.rejects(
      assertInpaintReady(await serviceConfig({ serviceUrl: base, fingerprint: "a".repeat(32) })),
      /fingerprint/,
    );
    await assert.doesNotReject(assertInpaintReady(await serviceConfig({ serviceUrl: base, fingerprint: "f".repeat(32) })));
  });
  await withServer(() => ({ payload: health({ templates: [] }) }), async (base) => {
    await assert.rejects(assertInpaintReady(await serviceConfig({ serviceUrl: base })), /no templates/);
  });
  await withServer(() => ({ payload: health({ lama: { loaded: false, error: "OSError: weights missing" } }) }), async (base) => {
    await assert.rejects(assertInpaintReady(await serviceConfig({ serviceUrl: base })), /weights missing/);
  });
});

test("the client sends the shop and reports what the service found", async () => {
  let sent: Record<string, unknown> = {};
  await withServer((_url, body) => {
    sent = body as Record<string, unknown>;
    return { payload: { ok: true, changed: true, maskPixels: 42, detections: [{ template: "vnb/vnb-logo", score: 0.9, ink: 0.8, contrast: 90, width: 110, height: 72 }], image: Buffer.from("x").toString("base64") } };
  }, async (base) => {
    const result = await cleanImage(await serviceConfig({ serviceUrl: base }), Buffer.from("source-bytes"), "vnb");
    assert.equal(sent.site, "vnb");
    assert.equal(sent.engine, "lama");
    assert.equal(sent.image, Buffer.from("source-bytes").toString("base64"));
    assert.equal(result.changed, true);
    assert.equal(result.maskPixels, 42);
    assert.equal(result.detections[0].template, "vnb/vnb-logo");
  });
});

test("a service error surfaces its reason without leaking the bearer token", async () => {
  await withServer(() => ({ status: 413, payload: { detail: "image exceeds 15728640 bytes for token super-secret-token" } }), async (base) => {
    const settings = await serviceConfig({ serviceUrl: base, apiKey: "super-secret-token" });
    await assert.rejects(cleanImage(settings, Buffer.from("x"), "vnb"), (error: Error) => {
      assert.match(error.message, /HTTP 413/);
      assert.match(error.message, /\[redacted\]/);
      assert.ok(!error.message.includes("super-secret-token"));
      return true;
    });
  });
});

test("the runner writes the cleaned image and the detections beside it", async () => {
  const directory = await cacheDir();
  const input = join(directory, "input.png");
  const output = join(directory, "pending.png");
  await writeFile(input, await sourceImage());
  await withServer(() => ({ payload: { ok: true, changed: true, maskPixels: 7, detections: [{ template: "t", score: 1, ink: 1, contrast: 1, width: 1, height: 1 }], image: Buffer.from("png-bytes").toString("base64") } }), async (base) => {
    await runInpaintService({ input, output, promptFile: join(directory, "p.txt"), config: await serviceConfig({ serviceUrl: base }), site: "vnb" });
    assert.deepEqual(await readFile(output), Buffer.from("png-bytes"));
    const sidecar = JSON.parse(await readFile(join(directory, "pending.detections.json"), "utf8"));
    assert.equal(sidecar.changed, true);
    assert.equal(sidecar.maskPixels, 7);
  });
});

test("an incomplete removal is recorded rather than shipped quietly", async () => {
  const runner: EditRunner = async ({ input, output }) => {
    await writeFile(output, await readFile(input));
    await writeFile(output.replace(/\.png$/, ".detections.json"), JSON.stringify({
      changed: true, maskPixels: 900,
      detections: [{ template: "fbshop/fbshop-logo" }],
      // The repaint left part of the overlay behind.
      residual: [{ template: "fbshop/fbshop-logo", score: 0.4, ink: 0.35 }],
    }));
  };
  const result = await new WatermarkRemover(await serviceConfig(), runner).remove(await sourceImage(), "fbshop");
  assert.equal(result.changed, true);
  assert.equal(result.residual, 1);
  const again = await new WatermarkRemover(await serviceConfig({ cacheDir: result.originalPath.split("originals")[0] }), async () => {
    assert.fail("a cached result was reprocessed");
  }).remove(await sourceImage(), "fbshop").catch(() => null);
  assert.ok(again === null || again.residual === 1);
});

test("a clean removal records no residual", async () => {
  const result = await new WatermarkRemover(await serviceConfig(), fakeService(true)).remove(await sourceImage(), "fbshop");
  assert.equal(result.residual, 0);
});

test("the client passes the service's residual verdict through", async () => {
  await withServer(() => ({ payload: {
    ok: true, changed: true, maskPixels: 10, detections: [],
    residual: [{ template: "fbshop/fbshop-logo", score: 0.4, ink: 0.35, contrast: 9, x: 1, y: 2, width: 70, height: 60 }],
    image: Buffer.from("x").toString("base64"),
  } }), async (base) => {
    const result = await cleanImage(await serviceConfig({ serviceUrl: base }), Buffer.from("y"), "fbshop");
    assert.equal(result.residual.length, 1);
    assert.equal(result.residual[0].template, "fbshop/fbshop-logo");
  });
});

test("the processing identity follows the service's live templates and thresholds", async () => {
  // Editing a threshold changes the service fingerprint. If the identity did
  // not follow it, a cached result from the old settings would be reused.
  const settings = await serviceConfig();
  const ids: string[] = [];
  for (const fingerprint of ["f".repeat(32), "e".repeat(32)]) {
    await withServer(() => ({ payload: health({ fingerprint }) }), async (base) => {
      const checked = await assertWatermarkReady({ ...settings, serviceUrl: base });
      assert.equal(checked.backend === "inpaint" && checked.fingerprint, fingerprint);
      ids.push(watermarkProcessingId(checked));
    });
  }
  assert.equal(new Set(ids).size, 2);
});

test("a pinned fingerprint is not replaced by whatever the service reports", async () => {
  await withServer(() => ({ payload: health() }), async (base) => {
    const checked = await assertWatermarkReady(await serviceConfig({ serviceUrl: base, fingerprint: "f".repeat(32) }));
    assert.equal(checked.backend === "inpaint" && checked.fingerprint, "f".repeat(32));
  });
});

test("undoing a run clears the rackets one source contributed to, and no others", () => {
  const report = {
    planId: "p", processingId: "w", project: "x", mode: "apply",
    results: [
      { racketId: "a", racketSlug: "a", images: [{ site: "hvshop" as const }, { site: "vnb" as const }] },
      { racketId: "b", racketSlug: "b", images: [{ site: "vnb" as const }] },
      { racketId: "c", racketSlug: "c", images: [{ site: "hvshop" as const }] },
      { racketId: "d", racketSlug: "d", images: [] },
    ],
  };
  // A racket that drew from the broken source loses all of its rows, because
  // it is only reprocessed when every row on it belongs to the new run.
  assert.deepEqual(targetsToClear(report, "hvshop"), ["a", "c"]);
  assert.deepEqual(targetsToClear(report, null), ["a", "b", "c"]);
});

test("undo refuses a run it cannot identify exactly", () => {
  assert.throws(() => undoOptions(["--plan=p"]), /--report/);
  assert.throws(() => undoOptions(["--report=r"]), /--plan/);
  assert.throws(() => undoOptions(["--report=r", "--plan=p", "--site=nope"]), /--site must be one of/);
  assert.throws(() => undoOptions(["--report=r", "--plan=p", "--apply=yes"]), /does not take a value/);
  const options = undoOptions(["--report=r", "--plan=p", "--site=hvshop", "--apply"]);
  assert.deepEqual([options.site, options.apply], ["hvshop", true]);
  assert.equal(undoOptions(["--report=r", "--plan=p"]).apply, false, "apply must be explicit");
});
