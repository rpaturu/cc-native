/**
 * Phase 7.1 — Contradiction field config (per-field rules: eq | no_backward | date_window).
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §5, §9.
 */

export type ContradictionFieldRule =
  | { kind: 'eq' }
  | { kind: 'no_backward'; ordering: string[] }
  | { kind: 'date_window'; max_days_delta: number };

export interface ContradictionFieldConfig {
  field: string;
  rule: ContradictionFieldRule;
}

let config: ContradictionFieldConfig[] = [];

export function getContradictionFieldConfig(): ContradictionFieldConfig[] {
  return config;
}

export function setContradictionFieldConfig(entries: ContradictionFieldConfig[]): void {
  config = entries ?? [];
}
