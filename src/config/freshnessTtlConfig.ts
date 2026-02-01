/**
 * Phase 7.1 — Freshness TTL config per source (hard_ttl_ms, soft_ttl_ms).
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §3, §9.
 */

export interface FreshnessTtlEntry {
  source_id: string;
  hard_ttl_ms: number;
  soft_ttl_ms: number;
}

const DEFAULT_DAYS_HARD = 14;
const DEFAULT_DAYS_SOFT = 7;
const MS_PER_DAY = 86400 * 1000;

const DEFAULT_HARD_MS = DEFAULT_DAYS_HARD * MS_PER_DAY;
const DEFAULT_SOFT_MS = DEFAULT_DAYS_SOFT * MS_PER_DAY;

/** In-memory config; can be replaced by SSM/table. Fail-fast: getTtlForSource throws if source not configured when strict=true. */
const DEFAULT_TTL: FreshnessTtlEntry[] = [
  { source_id: 'canonical.crm', hard_ttl_ms: DEFAULT_HARD_MS, soft_ttl_ms: DEFAULT_SOFT_MS },
  { source_id: 'canonical.support', hard_ttl_ms: DEFAULT_HARD_MS, soft_ttl_ms: DEFAULT_SOFT_MS },
  { source_id: 'usage_analytics', hard_ttl_ms: DEFAULT_HARD_MS, soft_ttl_ms: DEFAULT_SOFT_MS },
];

let config: FreshnessTtlEntry[] = [...DEFAULT_TTL];

export function getFreshnessTtlConfig(): FreshnessTtlEntry[] {
  return config;
}

export function setFreshnessTtlConfig(entries: FreshnessTtlEntry[]): void {
  config = entries.length ? entries : [...DEFAULT_TTL];
}

/**
 * Returns TTL for source_id. If not found and strict is true, throws (fail-fast).
 * If not found and strict is false, returns default 14d/7d.
 */
export function getTtlForSource(
  source_id: string,
  strict = false
): { hard_ttl_ms: number; soft_ttl_ms: number } {
  const entry = getFreshnessTtlConfig().find((e) => e.source_id === source_id);
  if (entry) return { hard_ttl_ms: entry.hard_ttl_ms, soft_ttl_ms: entry.soft_ttl_ms };
  if (strict) throw new Error(`Freshness TTL config missing for source_id=${source_id}`);
  return { hard_ttl_ms: DEFAULT_HARD_MS, soft_ttl_ms: DEFAULT_SOFT_MS };
}
