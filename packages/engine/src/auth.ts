// OAuth 2.1 resource-server guard for the review queue and MCP surface.
//
// A decision is an act of authority, so the engine never trusts a reviewerRole
// sent in a request body. Instead the caller presents a Bearer access token; the
// role they may act as is derived from the token's scopes:
//
//   scope "og:decide:technical_supervisor"  -> may decide gates whose
//                                               reviewer.role is technical_supervisor
//   scope "og:decide:*"                      -> may decide any gate
//
// This file ships a dependency-free HS256 verifier (shared-secret, audience-bound
// per RFC 8707) good for service-to-service and local dev. For production, pass a
// `verify` hook that validates RS256/ES256 against your authorization server's
// JWKS — the rest of the contract is unchanged.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface Principal {
  sub: string;
  scopes: string[];
}

export interface JwtClaims {
  sub?: string;
  scope?: string;
  scopes?: string[];
  aud?: string | string[];
  iss?: string;
  exp?: number;
  [k: string]: unknown;
}

export type Verifier = (token: string) => Promise<JwtClaims> | JwtClaims;

export interface AuthOptions {
  /** Shared secret for the built-in HS256 verifier. */
  secret?: string;
  /** Expected audience (this resource's URI), RFC 8707 audience binding. */
  audience?: string;
  /** Expected token issuer (authorization server). */
  issuer?: string;
  /** Plug a real JWKS/asymmetric verifier here in production. */
  verify?: Verifier;
  /** Clock for expiry checks (ms). Defaults to wall-clock — auth is time-bound. */
  now?: () => number;
}

export interface AuthError extends Error {
  status: number;
  wwwAuthenticate?: string;
}

function authError(status: number, message: string, www?: string): never {
  const e = new Error(message) as AuthError;
  e.status = status;
  e.wwwAuthenticate = www;
  throw e;
}

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** Built-in HS256 verification. Checks signature, alg, exp, aud, iss. */
function verifyHs256(token: string, opts: AuthOptions): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) authError(401, "malformed JWT");
  const [h, p, sig] = parts;
  const header = b64urlJson(h) as { alg?: string };
  if (header.alg !== "HS256") authError(401, `unsupported alg ${header.alg}; expected HS256`);
  if (!opts.secret) authError(500, "auth misconfigured: no secret for HS256");

  const expected = createHmac("sha256", opts.secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (expected.length !== got.length || !timingSafeEqual(expected, got))
    authError(401, "invalid token signature");

  return b64urlJson(p) as JwtClaims;
}

function scopesOf(claims: JwtClaims): string[] {
  if (Array.isArray(claims.scopes)) return claims.scopes;
  if (typeof claims.scope === "string") return claims.scope.split(" ").filter(Boolean);
  return [];
}

/** Verify a `Authorization: Bearer <jwt>` header into a Principal. */
export async function authenticate(
  authorization: string | undefined,
  opts: AuthOptions,
): Promise<Principal> {
  const www = `Bearer${opts.audience ? ` resource_metadata="${opts.audience}/.well-known/oauth-protected-resource"` : ""}`;
  if (!authorization?.startsWith("Bearer "))
    authError(401, "missing bearer token", www);
  const token = authorization.slice(7).trim();

  const claims = opts.verify ? await opts.verify(token) : verifyHs256(token, opts);

  const now = (opts.now ?? Date.now)();
  if (typeof claims.exp === "number" && claims.exp * 1000 <= now)
    authError(401, "token expired", www);
  if (opts.issuer && claims.iss !== opts.issuer)
    authError(401, `unexpected issuer ${claims.iss}`, www);
  if (opts.audience) {
    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!aud.includes(opts.audience)) authError(401, "token audience mismatch", www);
  }
  if (!claims.sub) authError(401, "token has no subject");

  return { sub: String(claims.sub), scopes: scopesOf(claims) };
}

/** The reviewer role a principal is authorized to act as for this gate. */
export function authorizedRole(p: Principal, gateRole: string): string {
  const ok = p.scopes.includes(`og:decide:${gateRole}`) || p.scopes.includes("og:decide:*");
  if (!ok) authError(403, `token lacks scope og:decide:${gateRole}`);
  return gateRole; // proven, not self-asserted
}

/** Assert the principal holds a scope (e.g. og:enqueue, og:lease). */
export function requireScope(p: Principal, scope: string): void {
  if (!p.scopes.includes(scope) && !p.scopes.includes("og:*"))
    authError(403, `token lacks scope ${scope}`);
}
