/**
 * Shared HTTP layer for the scrapers: timeouts, retries with backoff, a polite
 * delay between requests to the same host, and a small concurrency pool.
 *
 * Every scraper goes through here so that rate-limit behaviour is defined in
 * one place rather than re-invented per site.
 */

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const HTML_HEADERS: Record<string, string> = {
  "User-Agent": DEFAULT_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
};

export const JSON_HEADERS: Record<string, string> = {
  "User-Agent": DEFAULT_USER_AGENT,
  Accept: "application/json",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Minimum gap between successive requests, applied by the caller's pool. */
  verbose?: boolean;
  /** Defaults to GET. Some storefront APIs list their catalogue over POST. */
  method?: "GET" | "POST";
  /** Serialised request body, sent as-is when `method` is POST. */
  body?: string;
  /**
   * Caller's abort signal, combined with the per-request timeout below. The
   * scraper orchestrator uses it to abandon a shop that has stopped answering;
   * once it fires, no further attempt is made, because the caller has already
   * stopped waiting for an answer.
   */
  signal?: AbortSignal;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  body: string;
  headers: Headers;
}

/**
 * The per-request timeout and the caller's own signal are two independent
 * reasons to stop, and `fetch` takes one signal. `AbortSignal.any` is the
 * union of them; with no caller signal there is nothing to combine and the
 * timeout controller is passed through untouched.
 */
function combineSignals(timeout: AbortSignal, caller?: AbortSignal): AbortSignal {
  return caller ? AbortSignal.any([timeout, caller]) : timeout;
}

/**
 * An abort raised by the caller reads as "the run gave up on this host", not
 * as "the request timed out" — the two are indistinguishable in a bare
 * `AbortError`, and the site report prints whichever reason it is handed.
 */
function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(reason ? String(reason) : "Request aborted by the caller");
}

/**
 * Fetch with an abort timeout and exponential backoff. A 404 is returned as-is
 * rather than retried — for a paginated walk it is the normal end-of-list
 * signal, not a failure.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResponse> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const retries = options.retries ?? 3;
  const headers = options.headers ?? HTML_HEADERS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Checked before the backoff as well as before the request: retrying a
    // host the caller has given up on is the one thing that would keep an
    // abandoned site running long after the run moved on.
    options.signal?.throwIfAborted();

    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      if (options.verbose) {
        console.log(`      retry ${attempt}/${retries} after ${backoff}ms — ${url}`);
      }
      await sleep(backoff);
      options.signal?.throwIfAborted();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers,
        signal: combineSignals(controller.signal, options.signal),
        redirect: "follow",
        method: options.method ?? "GET",
        ...(options.body === undefined ? {} : { body: options.body }),
      });
      clearTimeout(timeoutId);

      // 404/410 mean "no such page" — a definitive answer, not a transient fault.
      if (res.status === 404 || res.status === 410) {
        return { ok: false, status: res.status, body: "", headers: res.headers };
      }

      // 429 and 5xx are worth another attempt.
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        if (attempt === retries) {
          return { ok: false, status: res.status, body: "", headers: res.headers };
        }
        continue;
      }

      const body = await res.text();
      return { ok: res.ok, status: res.status, body, headers: res.headers };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      // The caller aborted, so this is not a transient fault to retry past.
      if (options.signal?.aborted) throw abortError(options.signal);
      if (attempt === retries) {
        throw lastError;
      }
    }
  }

  throw lastError;
}

export interface BinaryResponse {
  ok: boolean;
  status: number;
  body: Uint8Array;
  contentType: string;
}

/**
 * The same retry policy as `fetchWithRetry`, but keeping the bytes.
 *
 * Images cannot go through the text path: `res.text()` decodes as UTF-8 and
 * mangles every byte above 0x7F, which for a PNG is most of them. Gzipped
 * sitemaps have the same problem.
 */
export async function fetchBinary(
  url: string,
  options: FetchOptions = {},
): Promise<BinaryResponse> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const retries = options.retries ?? 2;
  const headers = options.headers ?? HTML_HEADERS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    options.signal?.throwIfAborted();
    if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers,
        signal: combineSignals(controller.signal, options.signal),
        redirect: "follow",
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get("content-type")?.split(";")[0].trim() ?? "";

      if (res.status === 404 || res.status === 410 || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return { ok: false, status: res.status, body: new Uint8Array(), contentType };
      }

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        if (attempt === retries) {
          return { ok: false, status: res.status, body: new Uint8Array(), contentType };
        }
        continue;
      }

      const body = new Uint8Array(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, body, contentType };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      if (options.signal?.aborted) throw abortError(options.signal);
      if (attempt === retries) throw lastError;
    }
  }

  throw lastError;
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight, pausing
 * `delayMs` between dispatches so we never burst a small shop's server.
 */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  // The first error any worker throws. Recorded rather than thrown straight
  // out of the runner so the other runners can stop dispatching: without it,
  // `Promise.all` rejects while the remaining runners keep walking a site
  // whose result the caller has already given up on. Held on an object so the
  // runners and the code after `Promise.all` see the same value.
  const state: { failure?: { error: unknown } } = {};

  async function run(): Promise<void> {
    while (!state.failure) {
      const index = cursor++;
      if (index >= items.length) return;
      if (delayMs > 0) await sleep(delayMs);
      if (state.failure) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        state.failure ??= { error };
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  if (state.failure) throw state.failure.error;
  return results;
}

/** Decode the HTML entities that show up in WooCommerce titles and prices. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

/** Collapse the tabs and newlines that theme templates leave inside titles. */
export function cleanText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/**
 * Parse a Vietnamese price string ("3.500.000 ₫", "1.200.000đ") into an integer
 * number of dong. Returns 0 when there is no plausible price in the string.
 */
export function parseVndPrice(text: string): number {
  if (!text) return 0;
  const cleaned = decodeEntities(text).replace(/\s/g, "");
  // Grab the first run of digits with dot/comma group separators.
  const match = cleaned.match(/(\d{1,3}(?:[.,]\d{3})+|\d{4,})/);
  if (!match) return 0;
  const value = parseInt(match[1].replace(/[.,]/g, ""), 10);
  return Number.isFinite(value) ? value : 0;
}
