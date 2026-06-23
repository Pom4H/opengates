// Mint an OAuth 2.1 access token for the Open Gates review queue.
//
//   OG_JWT_SECRET=… node engine/src/token.ts \
//     --actor supervisor:ivanov --role technical_supervisor [--ttl 86400]
//
// Prints a signed HS256 JWT to stdout (pipeable). It is verified by
// engine/src/auth.ts, which binds the reviewer role to the token's scope:
// `og:decide:<role>` lets the holder decide a gate whose reviewer.role is
// <role>. The deployment must run with the same OG_JWT_SECRET (and, if set,
// OG_RESOURCE_URI / OG_ISSUER, which become the token audience / issuer).
//
// This is a dependency-free signer (node:crypto only). For production, issue
// tokens from a real authorization server; the verifier accepts any RS256/ES256
// JWT via its pluggable `verify` hook.

import { createHmac } from "node:crypto";

const b64 = (o: unknown): string =>
  Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

interface Parsed {
  actor?: string;
  roles: string[];
  scopes: string[];
  ttl?: number;
}

function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { roles: [], scopes: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === "--actor" || a === "--sub") out.actor = val();
    else if (a === "--role") out.roles.push(val());
    else if (a === "--scope") out.scopes.push(val());
    else if (a === "--ttl") out.ttl = Number(val());
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

const secret = process.env.OG_JWT_SECRET;
if (!secret) {
  console.error("set OG_JWT_SECRET (the same secret the server runs with)");
  process.exit(1);
}

const { actor, roles, scopes, ttl } = parseArgs(process.argv.slice(2));
if (!actor) {
  console.error(
    "usage: OG_JWT_SECRET=… node engine/src/token.ts --actor <id> --role <role> [--role <role>] [--scope <scope>] [--ttl <seconds>]",
  );
  process.exit(1);
}

const scopeSet = new Set<string>([
  "og:read",
  "og:enqueue",
  "og:lease",
  ...roles.map((r) => `og:decide:${r}`),
  ...scopes,
]);

const iat = Math.floor(Date.now() / 1000);
const payload: Record<string, unknown> = {
  sub: actor,
  scope: [...scopeSet].join(" "),
  iat,
};
if (ttl) payload.exp = iat + ttl;
if (process.env.OG_RESOURCE_URI) payload.aud = process.env.OG_RESOURCE_URI;
if (process.env.OG_ISSUER) payload.iss = process.env.OG_ISSUER;

const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
const sig = createHmac("sha256", secret).update(head).digest("base64url");

console.error(`# OAuth 2.1 token for ${actor} (scope: ${payload.scope}${ttl ? `, ttl ${ttl}s` : ", no expiry"})`);
console.log(`${head}.${sig}`);
