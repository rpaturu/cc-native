/**
 * Phase 5.7 — Circuit breaker state and resilience types.
 * Contract: PHASE_5_7_CODE_LEVEL_PLAN.md §1 (Circuit Breakers).
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStateV1 {
  pk: string; // CONNECTOR#<connector_id>
  sk: string; // STATE
  state: CircuitState;
  failure_count: number;
  window_start_epoch_sec: number;
  open_until_epoch_sec?: number;
  half_open_probe_in_flight?: boolean;
  ttl_epoch_sec?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  windowSeconds: number;
  cooldownSeconds: number;
  stateTtlDays: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  windowSeconds: 60,
  cooldownSeconds: 30,
  stateTtlDays: 14,
};
