import { createHash } from 'node:crypto';

export const MAX_DOCUMENT_BYTES = 1_048_576;

/** Canonical JSON, the chain's rules: sorted keys at every level, no whitespace. Copied, not imported: the package carries no runtime dependency. */
export function jcs(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('A number here is not finite.');
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcs(o[k])).join(',') + '}';
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

export interface SizedSection {
  /** The items kept, or the whole value when it was not an array. */
  value: unknown;
  truncated: boolean;
  itemCount?: number;
  keptCount?: number;
  /** SHA-256 of the full canonical serialisation, so a holder of the original can prove it matches. */
  sha256?: string;
}

/**
 * A section (inputs or outputs) cut at an item boundary when it is over the cap: the first N
 * whole items that fit, then the count and the fingerprint of the full thing. Half an item is
 * never sent. A non-array value over the cap is replaced by its fingerprint alone.
 */
export function sizeSection(value: unknown, maxBytes: number): SizedSection {
  const full = jcs(value ?? null);
  if (utf8Bytes(full) <= maxBytes) return { value, truncated: false };
  const sha256 = sha256Hex(full);
  if (!Array.isArray(value)) return { value: null, truncated: true, sha256 };
  const kept: unknown[] = [];
  let used = 2;
  for (const item of value) {
    const size = utf8Bytes(jcs(item)) + 1;
    if (used + size > maxBytes) break;
    kept.push(item);
    used += size;
  }
  return { value: kept, truncated: true, itemCount: value.length, keptCount: kept.length, sha256 };
}

export interface BinarySummary {
  item: number;
  property: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: string;
  sha256?: string;
  hashed: boolean;
}

/** The document as the server takes it (locker.run/1), with the sized sections in place. */
export function buildRunDocument(parts: {
  clientVersion: string;
  workflowId?: string;
  workflowName?: string;
  executionId?: string;
  mode?: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  inputs: SizedSection;
  outputs: SizedSection;
  binaries: BinarySummary[];
  labels: Record<string, string>;
}): Record<string, unknown> {
  const section = (s: SizedSection) =>
    s.truncated ? { items: s.value, truncated: true, itemCount: s.itemCount, keptCount: s.keptCount, sha256: s.sha256 } : { items: s.value, truncated: false };
  return {
    schema: 'locker.run/1',
    platform: 'n8n',
    client: { name: 'n8n-nodes-flurryport-locker', version: parts.clientVersion },
    workflow: { id: parts.workflowId, name: parts.workflowName },
    run: { id: parts.executionId, status: parts.status, startedAt: parts.startedAt, finishedAt: parts.finishedAt, mode: parts.mode },
    inputs: section(parts.inputs),
    outputs: section(parts.outputs),
    binaries: parts.binaries.length ? parts.binaries : undefined,
    labels: Object.keys(parts.labels).length ? parts.labels : undefined,
  };
}

/** The metadata-only stub the node retries with after a 413: hashes kept, inputs and outputs removed. */
export function stubOf(document: Record<string, unknown>): Record<string, unknown> {
  const inputs = document.inputs as { sha256?: string } | undefined;
  const outputs = document.outputs as { sha256?: string } | undefined;
  return {
    ...document,
    stub: true,
    inputs: { stub: true, sha256: inputs?.sha256 ?? sha256Hex(jcs(document.inputs ?? null)) },
    outputs: { stub: true, sha256: outputs?.sha256 ?? sha256Hex(jcs(document.outputs ?? null)) },
  };
}
