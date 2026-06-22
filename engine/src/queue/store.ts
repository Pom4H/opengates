// Pluggable persistence for the review queue.
//
// The whole queue — items plus inboxes — is one JSON document (a QueueSnapshot).
// Two stores ship here:
//   - createFileStore — durable, atomic writes; the default for the server.
//   - createMemoryStore — process-lifetime only; used by tests.
//
// Both are dependency-free (Node built-ins). A KV/Redis store can be added by
// implementing the same Store interface; nothing else in the queue changes.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QueueSnapshot } from "./types.ts";

export interface Store {
  load(): Promise<QueueSnapshot>;
  save(snapshot: QueueSnapshot): Promise<void>;
}

const empty = (): QueueSnapshot => ({ items: [], inboxes: [] });

/** Accept the current snapshot shape, or migrate a legacy bare-array file. */
function normalize(parsed: unknown): QueueSnapshot {
  if (Array.isArray(parsed)) return { items: parsed, inboxes: [] };
  const o = parsed as Partial<QueueSnapshot> | null;
  return {
    items: Array.isArray(o?.items) ? o!.items : [],
    inboxes: Array.isArray(o?.inboxes) ? o!.inboxes : [],
  };
}

/** In-memory store. Durable only for the life of the process. */
export function createMemoryStore(seed: QueueSnapshot = empty()): Store {
  let snap: QueueSnapshot = structuredClone(seed);
  return {
    async load() {
      return structuredClone(snap);
    },
    async save(next) {
      snap = structuredClone(next);
    },
  };
}

/**
 * File-backed store. The snapshot is written atomically (temp file + rename) so
 * a crash mid-write can never leave a half-written, corrupt file. Point the path
 * at a mounted volume (e.g. /data/queue.json) to persist across restarts.
 */
export function createFileStore(path: string): Store {
  return {
    async load() {
      try {
        return normalize(JSON.parse(await readFile(path, "utf8")));
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return empty();
        throw err;
      }
    },
    async save(snapshot) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      await rename(tmp, path);
    },
  };
}
