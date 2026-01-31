/**
 * Resilience Wrapper - Phase 5.7
 *
 * Single choke point for circuit breaker, backpressure, and SLO metrics.
 * No connector call bypasses this wrapper.
 *
 * Contract: PHASE_5_7_CODE_LEVEL_PLAN.md §6, §1 (OPEN behavior by call-type).
 */

import { Logger } from '../core/Logger';
import type { CircuitBreakerService } from './CircuitBreakerService';
import type { ConnectorConcurrencyService } from './ConnectorConcurrencyService';
import type { ToolSloMetricsService } from './ToolSloMetricsService';

export type ResilienceCallType = 'phase4_execution' | 'phase5_perception';

export type InvokeWithResilienceResult<T> =
  | { kind: 'success'; value: T }
  | { kind: 'defer'; retryAfterSeconds: number };

const DEFER_RETRY_DEFAULT_SEC = 30;

/**
 * Invoke a connector call with circuit breaker, backpressure, and SLO metrics.
 * Phase 4 execution: OPEN -> FAIL_FAST (throw). Phase 5.3 perception: OPEN -> DEFER.
 */
export async function invokeWithResilience<T>(
  toolName: string,
  tenantId: string | undefined,
  connectorId: string,
  callType: ResilienceCallType,
  fn: () => Promise<T>,
  deps: {
    circuitBreaker: CircuitBreakerService;
    concurrency: ConnectorConcurrencyService;
    metrics: ToolSloMetricsService;
    logger: Logger;
  }
): Promise<InvokeWithResilienceResult<T>> {
  const { circuitBreaker, concurrency, metrics, logger } = deps;
  const startMs = Date.now();

  const allow = await circuitBreaker.allowRequest(connectorId);
  if (!allow.allowed) {
    if (callType === 'phase4_execution') {
      const err = new Error(
        `Circuit breaker OPEN for connector ${connectorId}; failing fast (Phase 4 execution). ` +
          `Retry after ${allow.retryAfterSeconds ?? DEFER_RETRY_DEFAULT_SEC}s.`
      );
      err.name = 'CircuitBreakerOpenError';
      throw err;
    }
    return {
      kind: 'defer',
      retryAfterSeconds: allow.retryAfterSeconds ?? DEFER_RETRY_DEFAULT_SEC,
    };
  }

  const acquired = await concurrency.tryAcquire(connectorId);
  if (!acquired.acquired) {
    return {
      kind: 'defer',
      retryAfterSeconds: acquired.retryAfterSeconds ?? DEFER_RETRY_DEFAULT_SEC,
    };
  }

  try {
    const value = await fn();
    const latencyMs = Date.now() - startMs;
    await circuitBreaker.recordSuccess(connectorId);
    await metrics.emit({
      toolName,
      connectorId,
      tenantId,
      latencyMs,
      success: true,
    });
    return { kind: 'success', value };
  } catch (e) {
    const latencyMs = Date.now() - startMs;
    await circuitBreaker.recordFailure(connectorId);
    await metrics.emit({
      toolName,
      connectorId,
      tenantId,
      latencyMs,
      success: false,
    });
    throw e;
  } finally {
    await concurrency.release(connectorId);
  }
}

/**
 * Derive connector_id from tool_name for resilience keying.
 * internal.* -> internal, crm.* -> crm_salesforce, calendar.* -> calendar.
 */
export function connectorIdFromToolName(toolName: string): string {
  if (toolName.startsWith('internal.')) return 'internal';
  if (toolName.startsWith('crm.')) return 'crm_salesforce';
  if (toolName.startsWith('calendar.')) return 'calendar';
  const first = toolName.split('.')[0];
  return first === undefined || first === '' ? 'unknown' : first;
}
