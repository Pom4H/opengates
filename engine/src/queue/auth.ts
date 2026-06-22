// Reviewer identity for the review queue.
//
// The queue's whole point is *responsibility*: a named role accepted a fact.
// But on the open HTTP API both `actor` and `reviewerRole` are self-asserted
// strings — anyone could record a decision as anyone. This module closes that
// gap with a tiny, dependency-free credential: an HMAC-signed bearer token that
// names an authenticated subject and the roles it may act as.
//
//   token = v1.<base64url(claims)>.<base64url(HMAC-SHA256(secret, "v1.<claims>"))>
//
// It deliberately is NOT a full JWT/JOSE stack — just enough to bind a decision
// to an identity the deployment issued. Auth lives at the transport boundary
// (see http.ts); the fold engine stays a pure function and never sees a key.

import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

/** An authenticated caller: who they are, and which reviewer roles they hold. */
export interface Principal {
  /** Subject — the stable identity recorded as the actor of a decision. */
  sub: string;
  /** Reviewer roles this subject is authorized to act as. */
  roles: string[];
}

/** Claims encoded into a token. `exp`/`iat` are seconds since the epoch. */
export interface TokenClaims {
  sub: string;
  roles: string[];
  exp?: number;
  iat?: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sign a reviewer token. Throws on an empty secret or a missing subject. */
export function signToken(secret: string, claims: TokenClaims): string {
  if (!secret) throw new Error("signToken requires a non-empty secret");
  if (!claims.sub) throw new Error("signToken requires a subject (sub)");
  const body = b64url(
    JSON.stringify({ ...claims, roles: claims.roles ?? [] }),
  );
  const head = `${VERSION}.${body}`;
  const sig = b64url(createHmac("sha256", secret).update(head).digest());
  return `${head}.${sig}`;
}

/**
 * Verify a token against the secret. Returns the authenticated Principal, or
 * `null` if the token is malformed, tampered with, signed by another secret, or
 * expired. The signature is compared in constant time.
 */
export function verifyToken(
  secret: string,
  token: string,
  now: () => Date = () => new Date(),
): Principal | null {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [v, body, sig] = parts;
  if (v !== VERSION) return null;

  const expected = createHmac("sha256", secret).update(`${v}.${body}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims.sub !== "string") return null;
  if (typeof claims.exp === "number" && claims.exp * 1000 <= now().getTime()) {
    return null;
  }
  const roles = Array.isArray(claims.roles)
    ? claims.roles.filter((r): r is string => typeof r === "string")
    : [];
  return { sub: claims.sub, roles };
}

/** Pulls a token out of an `Authorization` header (with or without "Bearer "). */
export function bearer(authorization?: string): string | undefined {
  if (!authorization) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return (m ? m[1] : authorization).trim() || undefined;
}

export interface Authenticator {
  /** True when a secret is configured and auth is enforced on stateful routes. */
  readonly enabled: boolean;
  /** Authenticate an `Authorization` header value; null if absent/invalid. */
  authenticate(authorization?: string): Principal | null;
}

/**
 * Build an authenticator from the deployment secret. When no secret is given
 * (or it is blank), `enabled` is false and the queue stays open — preserving the
 * zero-config local/dev behavior. Set `OPEN_GATES_SECRET` to lock it down.
 */
export function createAuthenticator(
  secret?: string,
  now: () => Date = () => new Date(),
): Authenticator {
  const key = secret?.trim();
  return {
    enabled: !!key,
    authenticate(authorization) {
      if (!key) return null;
      const token = bearer(authorization);
      return token ? verifyToken(key, token, now) : null;
    },
  };
}
