# AGENTS.md

## Cursor Cloud specific instructions

Open Gates is a spec + dependency-free TypeScript reference engine (Node type-strips
`.ts` directly — there is **no build step** and the engine/root have **no npm
dependencies**). See `README.md`, `CONTRIBUTING.md`, `docs/REVIEW-QUEUE.md`, and
`packages/engine/README.md` for the authoritative commands.

### Node version (important, non-obvious)
- The project requires **Node >= 22.18** (`package.json` `engines`) because it relies
  on Node's built-in TypeScript type stripping. On an older Node (e.g. the sandbox's
  default `22.14`) commands like `npm test` / `npm run serve` fail with
  `ERR_UNKNOWN_FILE_EXTENSION ".ts"`.
- The correct runtime (`nvm` default `v22.22.2`) is selected via a line appended to
  `~/.bashrc`. If a shell ever reports `node --version` as `22.14`, run `nvm use
  default` (or start a login shell) before running project commands.

### Run / test the core (no install needed)
- Tests: `npm test`; conformance: `npm run conformance`; example folds:
  `npm run demo:accept` (and `demo:dispute`, `demo:remarks`, `demo:logistics`, `demo:zone`).

### Review queue service (primary runtime app)
- Start: `npm run serve` → HTTP on `:3000` (`PORT` env). Health: `GET /health`.
- State persists to `./data/queue.json` (the `data/` dir is gitignored).
- Lifecycle is enqueue → lease → decide → release (`POST /queue`, `POST /queue/lease`,
  `POST /queue/:id/decision`, ...). Set `OG_JWT_SECRET` to require OAuth on decisions.

### Viz viewer (optional)
- Serve the repo statically: `python3 -m http.server 8099`, then open
  `http://localhost:8099/viz/viewer/`. Regenerate bindings with `npm run viz:attachments`.
- Note: the vendored three.js (`viz/viewer/vendor/three/three.module.js`) imports a
  `three.core.js` that is not present in the repo, so the 3D viewer may fail to render
  out of the box. This is a repository packaging issue, not an environment issue.

### Remotion media (optional, heavy)
- Lives in `remotion/` and is the only part needing `npm install` (run inside
  `remotion/`). Renders (`npm run render` etc.) download a headless Chromium on first use.
