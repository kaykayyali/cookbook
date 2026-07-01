// ════════════════════════════════════════════════════════
// extract.js — POST /api/extract: URL → schema.org/Recipe
// Auth-gated by functions/api/_middleware.js (context.data.auth = { sub, email, name, picture }).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from "../_lib/http.js";
import { handleExtract } from "../_lib/extract.js";

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

// In-memory per-email sliding-window rate limiter. Resets when the caller's
// 60s window elapses. NOTE: per-isolate state — not shared across the fleet;
// adequate for abuse-limiting a free-tier extraction endpoint.
const rateBuckets = new Map(); // email -> { windowStart, count }

function rateLimited(email, perMin) {
	const now = Date.now();
	const b = rateBuckets.get(email);
	if (!b || now - b.windowStart > 60_000) {
		// Opportunistic GC: when a fresh bucket is created for a caller, sweep the
		// map and drop any entry whose 60s window has elapsed. Keeps the map
		// bounded over time without iterating on every call.
		if (rateBuckets.size > 0) {
			for (const [k, v] of rateBuckets) {
				if (now - v.windowStart > 60_000) rateBuckets.delete(k);
			}
		}
		rateBuckets.set(email, { windowStart: now, count: 1 });
		return false;
	}
	b.count++;
	return b.count > perMin;
}

/**
 * Real deps for production: fetch with size+timeout caps (no Buffer —
 * TextDecoder streaming), and Workers AI via env.AI.
 * @param {object} env
 * @returns {{fetchPage: function, runLLM: function}}
 */
function realDeps(env) {
	return {
		fetchPage: async (url) => {
			const ctrl = new AbortController();
			const timeoutMs = Number(env.EXTRACT_TIMEOUT_MS) || 15000;
			const timeout = setTimeout(() => {
				console.error(
					`[Extract HTTP] Fetch timed out for URL: ${url} after ${timeoutMs}ms.`,
				);
				ctrl.abort();
			}, timeoutMs);

			try {
				console.log(
					`[Extract HTTP] Fetching target recipe page: ${url}`,
				);
				const res = await fetch(url, {
					signal: ctrl.signal,
					redirect: "follow",
					headers: {
						"User-Agent":
							"CookbookExtractor/1.0 (+https://cookbook-2ie.pages.dev)",
					},
				});

				const max = Number(env.EXTRACT_MAX_BYTES) || 2_000_000;
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let received = 0;
				const chunks = [];

				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					received += value.byteLength;

					if (received > max) {
						console.warn(
							`[Extract HTTP] Page payload exceeded size cap. Transferred ${received} bytes. Enforcing cutoff.`,
						);
						ctrl.abort();
						break;
					}
					chunks.push(decoder.decode(value, { stream: true }));
				}
				chunks.push(decoder.decode()); // flush any trailing bytes
				const html = chunks.join("");

				console.log(
					`[Extract HTTP] Successfully scraped HTML. Status: ${res.status}. Size: ${html.length} characters.`,
				);
				return { ok: res.ok, status: res.status, html };
			} catch (err) {
				console.error(
					`[Extract HTTP] Runtime exception fetching ${url}: ${err.message}`,
					err,
				);
				return { ok: false, status: 502, html: "" };
			} finally {
				clearTimeout(timeout);
			}
		},
		runLLM: async (messages) => {
			try {
				console.log(
					`[Workers AI] Dispatching inference call to model: ${AI_MODEL}`,
				);
				const out = await env.AI.run(AI_MODEL, { messages });
				const resultText =
					typeof out === "string" ? out : out?.response || "";
				console.log(
					`[Workers AI] LLM payload received successfully. Output size: ${resultText.length} characters.`,
				);
				return resultText;
			} catch (err) {
				console.error(
					`[Workers AI] Cloudflare Workers AI execution failed: ${err.message}`,
					err,
				);
				throw err; // Re-throw to let handleExtract bubble up error boundaries natively
			}
		},
	};
}

/**
 * POST /api/extract { url } -> { recipe } | { error }
 * Protected by _middleware.js (context.data.auth attached). Per-email rate limited.
 */
export async function onRequestPost(context) {
	const { request, env, data } = context;

	// 1. Verify Authentication Context
	// Claims arrive via context.data.auth (set by _middleware.js), NOT via
	// request.auth — expando properties on Request don't survive next() in
	// the Workers runtime, so reading request.auth here would always fail.
	const email = data && data.auth && data.auth.email;
	if (typeof email !== "string" || !email) {
		console.error(
			"[Route Extract] Request blocked: Context middleware authentication properties are missing or malformed.",
		);
		return json(401, { error: "invalid_token" });
	}

	// 2. Guard AI Bindings
	if (!env.AI || typeof env.AI.run !== "function") {
		console.error(
			"[Route Extract] Misconfigured: env.AI binding is missing or completely non-functional.",
		);
		return misconfigured("ai_binding");
	}

	// 3. Evaluate Rate Limits
	const perMin = Number(env.EXTRACT_RATE_PER_MIN) || 10;
	if (rateLimited(email, perMin)) {
		console.warn(
			`[Route Extract] Rate limit tripped for user account: ${email}. Cap: ${perMin}/min.`,
		);
		return json(429, { error: "rate_limited" });
	}

	// 4. Parse Inbound Request Data
	let body;
	try {
		body = await request.json();
	} catch (err) {
		console.error(
			`[Route Extract] Aborted: Malformed inbound JSON payload: ${err.message}`,
		);
		return json(400, { error: "bad_json" });
	}

	const targetUrl = body ? body.url : "UNDEFINED";
	console.log(
		`[Route Extract] Initializing pipeline for user: ${email} targeting URL: ${targetUrl}`,
	);

	// 5. Execute Extraction Core
	const { status, body: out } = await handleExtract(body, env, realDeps(env));

	if (status >= 400) {
		console.warn(
			`[Route Extract] Core extractor completed with error code: ${status}. Data payload:`,
			JSON.stringify(out),
		);
	} else {
		console.log(
			`[Route Extract] Success processing endpoint routing task. Status returned: ${status}`,
		);
	}

	return json(status, out);
}
