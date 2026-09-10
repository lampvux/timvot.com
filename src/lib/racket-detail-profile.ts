import "server-only";

/**
 * Opt-in, structured timings for the racket-detail server render.
 *
 * Enable with `RACKET_DETAIL_PROFILE=1`. The logs intentionally contain no
 * request headers, cookies, API keys, or response bodies, so they are safe to
 * copy into a performance report. A single prefix also makes them easy to
 * extract from a noisy `next dev` log.
 */

const PROFILE_PREFIX = "[racket-detail-profile]";
const PROFILE_ENABLED = process.env.RACKET_DETAIL_PROFILE === "1";
const PROFILE_PATH =
  process.env.RACKET_DETAIL_PROFILE_PATH ?? "/vi/rackets/li-ning/li-ning-tectonic-6";

let sequence = 0;

type ProfileMeta = Record<string, boolean | number | string | null | undefined>;

function emit(
  kind: "function" | "query",
  name: string,
  durationMs: number,
  meta: ProfileMeta = {},
) {
  if (!PROFILE_ENABLED) return;

  // Write directly so Cache Components does not replay a cached console line
  // and make one physical query look like it ran more than once.
  process.stdout.write(
    `${PROFILE_PREFIX} ${JSON.stringify({
      sequence: ++sequence,
      pid: process.pid,
      kind,
      name,
      durationMs: Number(durationMs.toFixed(2)),
      profilePath: PROFILE_PATH,
      ...meta,
    })}\n`,
  );
}

export function isRacketDetailProfileEnabled(path?: string): boolean {
  return PROFILE_ENABLED && (!path || path === PROFILE_PATH);
}

export async function profileFunction<T>(
  name: string,
  operation: () => Promise<T>,
  meta: ProfileMeta = {},
): Promise<T> {
  if (!PROFILE_ENABLED || (typeof meta.path === "string" && meta.path !== PROFILE_PATH)) {
    return operation();
  }

  const started = performance.now();
  try {
    const result = await operation();
    emit("function", name, performance.now() - started, {
      outcome: "ok",
      ...meta,
    });
    return result;
  } catch (error) {
    emit("function", name, performance.now() - started, {
      outcome: "error",
      error: error instanceof Error ? error.name : "unknown",
      ...meta,
    });
    throw error;
  }
}

export function startFunctionProfile(): number | null {
  return PROFILE_ENABLED ? performance.now() : null;
}

export function finishFunctionProfile(
  name: string,
  started: number | null,
  meta: ProfileMeta = {},
) {
  if (
    started === null ||
    (typeof meta.path === "string" && meta.path !== PROFILE_PATH)
  ) {
    return;
  }
  emit("function", name, performance.now() - started, {
    outcome: "ok",
    ...meta,
  });
}

function describeSupabaseRequest(input: RequestInfo | URL) {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const apiIndex = segments.findIndex((segment) => ["auth", "rest", "storage"].includes(segment));
  const service = apiIndex >= 0 ? segments[apiIndex] : "other";
  const resource =
    service === "rest"
      ? (segments[apiIndex + 2] ?? "unknown")
      : segments.slice(apiIndex + 2).join("/") || "unknown";

  return { service, resource };
}

/**
 * Fetch implementation passed to Supabase clients. Each REST request is one
 * PostgREST query; Auth requests are logged separately and are not reported as
 * SQL queries.
 */
export function profiledSupabaseFetch(source: string, path?: string): typeof globalThis.fetch {
  return async (input, init) => {
    if (!isRacketDetailProfileEnabled(path)) {
      return globalThis.fetch(input, init);
    }

    const started = performance.now();
    const { service, resource } = describeSupabaseRequest(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");

    try {
      const response = await globalThis.fetch(input, init);
      emit(
        "query",
        service === "rest" ? `postgres.${resource}` : `supabase.${service}.${resource}`,
        performance.now() - started,
        {
          source,
          service,
          resource,
          method,
          status: response.status,
          contentRange: response.headers.get("content-range"),
          outcome: response.ok ? "ok" : "error",
        },
      );
      return response;
    } catch (error) {
      emit(
        "query",
        service === "rest" ? `postgres.${resource}` : `supabase.${service}.${resource}`,
        performance.now() - started,
        {
          source,
          service,
          resource,
          method,
          status: null,
          outcome: "error",
          error: error instanceof Error ? error.name : "unknown",
        },
      );
      throw error;
    }
  };
}
