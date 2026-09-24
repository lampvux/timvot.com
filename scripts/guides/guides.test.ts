import test from "node:test";
import assert from "node:assert/strict";
import { allowedUrl, extract, publicAddress, robotsAllow } from "./sources";
import { config, dailyKey } from "./config";
import { GuideLLM, parseChatResponse, parseJson } from "./llm";
import { similarity, topicKey } from "./novelty";

test("daily identity uses the selected timezone across UTC midnight", () => {
  assert.equal(dailyKey(new Date("2026-09-20T18:00:00Z"), "Asia/Hovd"), "daily:2026-09-21");
  assert.equal(dailyKey(new Date("2026-09-20T16:00:00Z"), "Asia/Hovd"), "daily:2026-09-20");
});
test("reversing comparison subjects does not mint another topic", () => {
  assert.equal(topicKey("comparison", ["Astrox 88D", "Astrox 88S"], "rear court"), topicKey("comparison", ["astrox 88s", "astrox 88d"], "Rear court"));
  assert.equal(similarity("same detailed topic", "same detailed topic"), 1);
  assert.ok(similarity("racket weight for beginners", "cleaning a badminton grip") < 0.1);
});
test("research rejects private URLs and credentials", () => {
  for (const url of ["http://localhost:20128", "https://127.0.0.1", "https://evil.example", "https://admin:secret@shopvnb.com", "https://shopvnb.com:8080/x"]) assert.throws(() => allowedUrl(url));
  for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.0.1", "172.16.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1"]) assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("robots uses specific groups, longest paths and wildcard rules", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*?sort=*";
  assert.equal(robotsAllow(robots, "/private/secrets"), false);
  assert.equal(robotsAllow(robots, "/private/public/article"), true);
  assert.equal(robotsAllow(robots, "/products?sort=price"), false);
  assert.equal(robotsAllow("User-agent: *\nDisallow: /\nUser-agent: ShuttlecraftGuideBot\nAllow: /", "/news"), true);
});
test("source extraction strips scripts and does not discover foreign hosts", () => {
  const page = extract('<main><h1>Racket facts</h1><p>Useful facts here.</p><script>secret</script><a href="/vot-cau-long-a">Product</a><a href="https://evil.example/racket">Other</a></main>', "https://shopvnb.com/");
  assert.ok(!page.text.includes("secret"));
  assert.deepEqual(page.links, ["https://shopvnb.com/vot-cau-long-a"]);
});
const settings = { baseUrl: "http://localhost:20128/v1", apiKey: "test-key", model: "test:free", freeModels: ["test:free"], allowedModels: ["test:free"], apiMode: "chat" as const, reasoningEffort: "low" as const, requestTimeoutMs: 600_000, timezone: "Asia/Hovd", output: "unused" };

test("explicit provider allowlist overrides the legacy free-only allowlist", () => {
  const env = { NINE_ROUTER_MODEL: " xai/grok-4.6 ", NINE_ROUTER_ALLOWED_MODELS: " xai/grok-4.6, xai/grok-4.5 ", NINE_ROUTER_FREE_MODELS: "oc/old-free" };
  const selected = config(env);
  assert.equal(selected.model, "xai/grok-4.6");
  assert.deepEqual(selected.allowedModels, ["xai/grok-4.6", "xai/grok-4.5"]);
  assert.deepEqual(selected.freeModels, ["oc/old-free"]);
  for (const value of [undefined, "", "   "]) {
    assert.deepEqual(config({ ...env, NINE_ROUTER_ALLOWED_MODELS: value }).allowedModels, ["oc/old-free"]);
  }
  assert.deepEqual(config({}).allowedModels, []);
  assert.equal(config({}).requestTimeoutMs, 600_000);
  assert.equal(config({ NINE_ROUTER_REQUEST_TIMEOUT_MS: "120000" }).requestTimeoutMs, 120_000);
  for (const value of ["", "59999", "1200001", "not-a-number"]) assert.throws(() => config({ NINE_ROUTER_REQUEST_TIMEOUT_MS: value }), /NINE_ROUTER_REQUEST_TIMEOUT_MS/);
});

test("missing configured model reports available provider IDs without switching models", async () => {
  let calls = 0;
  const client = new GuideLLM(settings, async (url) => {
    calls++;
    assert.match(String(url), /\/models$/);
    return Response.json({ data: [{ id: "xai/grok-4.6" }, { id: "xai/grok-4.5" }] });
  });
  const models = await client.check();
  assert.throws(() => client.assertConfigured(models), (error: Error) => {
    for (const text of ["test:free", "xai/grok-4.6", "xai/grok-4.5", ".env.local", "NINE_ROUTER_API_MODE"]) assert.ok(error.message.includes(text));
    assert.ok(!error.message.includes(settings.apiKey));
    return true;
  });
  assert.throws(() => client.assertConfigured([]), /connect a provider/);
  assert.equal(calls, 1);
});

test("explicitly allowed xAI model uses chat completions with its exact router ID", async () => {
  const selected = config({ NINE_ROUTER_API_KEY: "test-key", NINE_ROUTER_MODEL: "xai/grok-4.6", NINE_ROUTER_ALLOWED_MODELS: "xai/grok-4.6", NINE_ROUTER_API_MODE: "chat" });
  let calls = 0;
  const client = new GuideLLM(selected, async (url, init) => {
    calls++;
    assert.match(String(url), /\/chat\/completions$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "xai/grok-4.6");
    assert.equal(body.max_tokens, 1000);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.stream, true);
    assert.deepEqual(body.messages.map((message: { role: string }) => message.role), ["system", "user"]);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
  });
  client.assertConfigured(["xai/grok-4.6"]);
  assert.deepEqual(await client.json("test", {}, 1000), { ok: true });
  assert.equal(calls, 1);
});

test("chat providers other than xAI do not receive xAI reasoning controls", async () => {
  const client = new GuideLLM(settings, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal("reasoning_effort" in body, false);
    assert.equal(body.stream, false);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
  });
  assert.deepEqual(await client.json("test", {}), { ok: true });
});

test("xAI SSE chunks are assembled into one JSON object", async () => {
  const events = [
    { choices: [{ delta: { reasoning_content: "private" }, finish_reason: null }] },
    { choices: [{ delta: { content: '{"ok":' }, finish_reason: null }] },
    { choices: [{ delta: { content: "true}" }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ];
  const stream = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  assert.deepEqual(parseChatResponse(stream, "text/event-stream"), { content: '{"ok":true}', finishReason: "stop", choices: 1 });
  const client = new GuideLLM({ ...settings, model: "xai/grok-4.6", allowedModels: ["xai/grok-4.6"] }, async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  assert.deepEqual(await client.json("test", {}), { ok: true });
});

test("Responses API output is assembled from output_text parts", async () => {
  const client = new GuideLLM({ ...settings, apiMode: "responses" }, async (url, init) => {
    assert.match(String(url), /\/responses$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false);
    assert.equal(body.max_output_tokens, 10000);
    assert.equal(body.reasoning.effort, "low");
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }] });
  });
  assert.deepEqual(await client.json("test", {}), { ok: true });
});

test("malformed model JSON is retried within the request budget", async () => {
  let calls = 0;
  const client = new GuideLLM({ ...settings, apiMode: "responses" }, async () => {
    calls++;
    const text = calls === 1 ? '{"broken":]' : '{"ok":true}';
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text }] }] });
  });
  assert.deepEqual(await client.json("test", {}), { ok: true });
  assert.equal(calls, 2);
});
test("model timeouts identify the failed stage and configured limit", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const client = new GuideLLM({ ...settings, model: "xai/grok-4.6", allowedModels: ["xai/grok-4.6"], requestTimeoutMs: 240_000 }, async () => { throw timeout; });
  await assert.rejects(client.json("test", {}, 4500, "topic selection"), (error: Error) => {
    for (const text of ["topic selection", "240 seconds", "xai/grok-4.6", "nothing was published", "NINE_ROUTER_REQUEST_TIMEOUT_MS"]) assert.ok(error.message.includes(text));
    return true;
  });
});
test("unauthorized model fails before network access", async () => {
  let calls = 0;
  const client = new GuideLLM({ ...settings, model: "paid" }, async () => { calls++; return new Response(); });
  await assert.rejects(client.json("test", {}), /FREE_MODELS/);
  assert.equal(calls, 0);
});
test("auth errors are not retried; truncated/empty output cannot publish", async () => {
  let calls = 0;
  const auth = new GuideLLM(settings, async () => { calls++; return new Response("", { status: 401 }); });
  await assert.rejects(auth.json("test", {}), /HTTP 401/);
  assert.equal(calls, 1);
  for (const choice of [{ finish_reason: "length", message: { content: "{}" } }, { finish_reason: "stop", message: { content: "" } }]) {
    const client = new GuideLLM(settings, async () => Response.json({ choices: [choice] }));
    await assert.rejects(client.json("test", {}));
  }
  assert.deepEqual(parseJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseJson('Preface {"text":"a } brace","nested":{"ok":true}} trailing commentary'), {
    text: "a } brace",
    nested: { ok: true },
  });
});
