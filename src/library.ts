import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SnapshotStamp, SwizzleDocument, TransferLibrary } from "./types.js";

/**
 * The app publishes here once "Share with Claude" is enabled. The container name comes
 * from the iCloud container id with dots replaced by tildes, which is how iCloud Drive
 * exposes an app's Documents folder on the Mac.
 */
export const DEFAULT_SNAPSHOT_PATH = join(
  homedir(),
  "Library/Mobile Documents/iCloud~com~getswizzler~app/Documents/Library.swizzle",
);

export function snapshotPath(): string {
  return process.env.SWIZZLER_LIBRARY_PATH || DEFAULT_SNAPSHOT_PATH;
}

/** Past this, tool results carry an explicit warning rather than a quiet age note. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface Snapshot {
  library: TransferLibrary;
  stamp?: SnapshotStamp;
  /** When the app published it — the stamp if present, else the file's mtime. */
  publishedAt: Date;
  path: string;
}

export class SnapshotUnavailableError extends Error {
  constructor(readonly path: string, readonly cause: unknown) {
    super(`No Swizzler library snapshot at ${path}.`);
    this.name = "SnapshotUnavailableError";
  }
}

let cache: { path: string; mtimeMs: number; snapshot: Snapshot } | undefined;

/**
 * Re-reads whenever the file changes, so a long-lived server never serves a snapshot
 * the app has since refreshed.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  const path = snapshotPath();

  let mtimeMs: number;
  try {
    // Also materialises the file if iCloud has evicted it to a placeholder.
    mtimeMs = (await stat(path)).mtimeMs;
  } catch (cause) {
    throw new SnapshotUnavailableError(path, cause);
  }

  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) {
    return cache.snapshot;
  }

  let document: SwizzleDocument;
  try {
    document = JSON.parse(await readFile(path, "utf8")) as SwizzleDocument;
  } catch (cause) {
    throw new SnapshotUnavailableError(path, cause);
  }

  if (!document.library) {
    throw new SnapshotUnavailableError(path, new Error("document has no library"));
  }

  const snapshot: Snapshot = {
    library: document.library,
    stamp: document.stamp,
    publishedAt: document.stamp?.exportedAt
      ? new Date(document.stamp.exportedAt)
      : new Date(mtimeMs),
    path,
  };

  cache = { path, mtimeMs, snapshot };
  return snapshot;
}

export function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Appended to every tool result. The snapshot only refreshes while the app runs, so a
 * silent stale answer is the main way this server can mislead — say the age out loud.
 */
export function freshnessNote(snapshot: Snapshot, now = Date.now()): string {
  const ageMs = now - snapshot.publishedAt.getTime();
  const age = describeAge(ageMs);

  if (ageMs > STALE_AFTER_MS) {
    const device = snapshot.stamp?.deviceModel ?? "another device";
    return (
      `\n\n[!] This snapshot was published ${age} (from ${device}) and may be out of date. ` +
      "Swizzler only refreshes it while the app is open — open it to publish current recipes."
    );
  }

  return `\n\nSnapshot published ${age}.`;
}
