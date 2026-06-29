// ════════════════════════════════════════════════════════
// auth.js — POST /api/auth : verify Google ID token, mint session
// ════════════════════════════════════════════════════════
import { handleAuth } from "../_lib/handler.js";
import { verifyIdToken, makeJwksResolver } from "../_lib/google.js";
import { signSession } from "../_lib/session.js";
import { isAllowed } from "../_lib/whitelist.js";
import { json, misconfigured } from "../_lib/http.js";

// Production JWKS resolver — a cached JWKS-backed getKey. Built once per
// isolate. jose handles `kid` lookup and JWKS refresh internally.
const getKey = makeJwksResolver();

const deps = {
	verifyIdToken: (idToken, clientId) =>
		verifyIdToken(idToken, clientId, getKey),
	signSession,
	isAllowed,
};

export async function onRequestPost(context) {
	const { request, env } = context;

	// 1. Check Google Client ID Configurations
	if (
		typeof env.GOOGLE_CLIENT_ID !== "string" ||
		!env.GOOGLE_CLIENT_ID ||
		env.GOOGLE_CLIENT_ID.includes("replace-me")
	) {
		console.error(
			`[Route Auth] Google Client ID configuration invalid. Type: ${typeof env.GOOGLE_CLIENT_ID}`,
		);
		return misconfigured("google_client_id");
	}

	// 2. Check Session Secret Specifications
	if (
		typeof env.SESSION_SECRET !== "string" ||
		env.SESSION_SECRET.length < 16
	) {
		const lengthFound = env.SESSION_SECRET ? env.SESSION_SECRET.length : 0;
		console.error(
			`[Route Auth] Session Secret too short or missing. Expected >= 16 chars, got length: ${lengthFound}`,
		);
		return misconfigured("session_secret");
	}

	// 3. Parse and Catch Malformed Payloads
	let body;
	try {
		body = await request.json();
	} catch (err) {
		console.error(
			`[Route Auth] Failed parsing JSON body from request: ${err.message}`,
		);
		return json(400, { error: "bad_json" });
	}

	// 4. Log payload presence before jumping to business logic wrapper
	const tokenLength =
		body && typeof body.idToken === "string" ? body.idToken.length : 0;
	console.log(
		`[Route Auth] Passing request payload to handleAuth. Token payload size: ${tokenLength} characters.`,
	);

	const { status, body: out } = await handleAuth(body, env, deps);

	// 5. Track outgoing routing feedback anomalies
	if (status >= 400) {
		console.warn(
			`[Route Auth] handleAuth completed with failure status code: ${status}. Output payload:`,
			JSON.stringify(out),
		);
	}

	return json(status, out);
}
