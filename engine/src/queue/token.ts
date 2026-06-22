// Mint a reviewer bearer token for the Open Gates review queue.
//
//   OPEN_GATES_SECRET=... node engine/src/queue/token.ts \
//     --actor supervisor:ivanov --role technical_supervisor [--ttl 86400]
//
// Prints the signed token to stdout (so it is pipeable). Hand it to a reviewer —
// Claude, another harness, or a person — who presents it on every queue mutation
// as `Authorization: Bearer <token>`. The deployment must run with the same
// OPEN_GATES_SECRET so the server can verify it.

import { signToken } from "./auth.ts";

interface Parsed {
  actor?: string;
  roles: string[];
  ttl?: number;
}

function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { roles: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === "--actor" || a === "--sub") out.actor = val();
    else if (a === "--role") out.roles.push(val());
    else if (a === "--roles") out.roles.push(...val().split(",").map((r) => r.trim()).filter(Boolean));
    else if (a === "--ttl") out.ttl = Number(val());
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

const secret = process.env.OPEN_GATES_SECRET;
if (!secret) {
  console.error("set OPEN_GATES_SECRET (the same secret the server runs with)");
  process.exit(1);
}

const { actor, roles, ttl } = parseArgs(process.argv.slice(2));
if (!actor) {
  console.error(
    "usage: OPEN_GATES_SECRET=... node engine/src/queue/token.ts --actor <id> --role <role> [--role <role>] [--ttl <seconds>]",
  );
  process.exit(1);
}

const iat = Math.floor(Date.now() / 1000);
const token = signToken(secret, {
  sub: actor,
  roles,
  iat,
  exp: ttl ? iat + ttl : undefined,
});

// Token on stdout; the human-readable summary on stderr so piping stays clean.
console.error(
  `# token for ${actor} (roles: ${roles.join(", ") || "none"}${ttl ? `, ttl ${ttl}s` : ", no expiry"})`,
);
console.log(token);
