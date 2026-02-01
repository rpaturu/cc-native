/**
 * Phase 7.4 — Outcomes capture: write-only append, idempotency via dedupe record.
 * See PHASE_7_4_CODE_LEVEL_PLAN.md §3.
 */

import type {
  OutcomeCaptureInput,
  OutcomeEvent,
  PlanLinkedOutcomeCaptureInput,
  DownstreamOutcomeCaptureInput,
  DuplicateOutcome,
} from '../../types/governance/OutcomeTypes';
import { Logger } from '../core/Logger';
import { v4 as uuidv4 } from 'uuid';

const KEY_EVENTS = new Set([
  'ACTION_APPROVED',
  'ACTION_REJECTED',
  'PLAN_COMPLETED',
  'PLAN_ABORTED',
  'PLAN_EXPIRED',
]);

function isPlanLinked(input: OutcomeCaptureInput): input is PlanLinkedOutcomeCaptureInput {
  return input.event_type !== 'DOWNSTREAM_WIN' && input.event_type !== 'DOWNSTREAM_LOSS';
}

export interface OutcomesCaptureServiceConfig {
  logger: Logger;
  /** Evaluation time at entry (UTC ms). Derive once at request entry; do not use Date.now() here. */
  evaluationTimeUtcMs: number;
  /** Optional store: append outcome and dedupe record. If not set, in-memory only (for tests). */
  store?: {
    appendOutcome(event: OutcomeEvent): Promise<void>;
    putDedupeIfAbsent(key: string, outcomeId: string, pk: string, sk: string): Promise<boolean>;
    getDedupe(key: string): Promise<{ outcome_id: string } | null>;
  };
}

const inMemoryOutcomes: OutcomeEvent[] = [];
const inMemoryDedupe = new Map<string, { outcome_id: string }>();

export class OutcomesCaptureService {
  private logger: Logger;
  private getEvaluationTimeUtcMs: () => number;
  private store?: OutcomesCaptureServiceConfig['store'];

  constructor(config: OutcomesCaptureServiceConfig) {
    this.logger = config.logger;
    this.getEvaluationTimeUtcMs = () => config.evaluationTimeUtcMs;
    this.store = config.store;
  }

  async append(input: OutcomeCaptureInput): Promise<OutcomeEvent | DuplicateOutcome> {
    if (isPlanLinked(input)) {
      if (!input.plan_id) {
        throw new Error('plan_id required for plan-linked outcome');
      }
    } else {
      const down = input as DownstreamOutcomeCaptureInput;
      if (!down.account_id) throw new Error('account_id required for DOWNSTREAM_* outcome');
      const oppId = down.data?.opportunity_id;
      if (oppId == null) throw new Error('data.opportunity_id required for DOWNSTREAM_* outcome');
    }

    const eventType = input.event_type;
    const idempotencyKey = input.data?.idempotency_key as string | undefined;
    const planId = isPlanLinked(input) ? input.plan_id : (input as DownstreamOutcomeCaptureInput).account_id;
    const tenantId = input.tenant_id;

    if (KEY_EVENTS.has(eventType) && idempotencyKey) {
      const dedupeKey = `TENANT#${tenantId}#PLAN#${planId}#TYPE#${eventType}#IDEMP#${idempotencyKey}`;
      if (this.store) {
        const existing = await this.store.getDedupe(dedupeKey);
        if (existing) {
          return { duplicate: true, outcome_id: existing.outcome_id };
        }
      } else {
        const existing = inMemoryDedupe.get(dedupeKey);
        if (existing) return { duplicate: true, outcome_id: existing.outcome_id };
      }
    }

    const outcome_id = uuidv4();
    const timestamp_utc_ms = this.getEvaluationTimeUtcMs();
    const pk = isPlanLinked(input)
      ? `TENANT#${tenantId}#PLAN#${input.plan_id}`
      : `TENANT#${tenantId}#ACCOUNT#${(input as DownstreamOutcomeCaptureInput).account_id}`;
    const sk = `OUTCOME#${timestamp_utc_ms}#${outcome_id}`;

    const event: OutcomeEvent = isPlanLinked(input)
      ? {
          outcome_id,
          tenant_id: input.tenant_id,
          account_id: input.account_id,
          plan_id: input.plan_id,
          step_id: input.step_id,
          event_type: input.event_type,
          source: input.source,
          timestamp_utc_ms,
          ledger_entry_id: input.ledger_entry_id,
          data: input.data,
        }
      : {
          outcome_id,
          tenant_id: input.tenant_id,
          account_id: (input as DownstreamOutcomeCaptureInput).account_id,
          plan_id: (input as DownstreamOutcomeCaptureInput).plan_id,
          event_type: (input as DownstreamOutcomeCaptureInput).event_type,
          source: 'DOWNSTREAM',
          timestamp_utc_ms,
          data: input.data,
        };

    if (KEY_EVENTS.has(eventType) && idempotencyKey) {
      const dedupeKey = `TENANT#${tenantId}#PLAN#${planId}#TYPE#${eventType}#IDEMP#${idempotencyKey}`;
      if (this.store) {
        const placed = await this.store.putDedupeIfAbsent(dedupeKey, outcome_id, pk, sk);
        if (!placed) {
          const existing = await this.store.getDedupe(dedupeKey);
          return { duplicate: true, outcome_id: existing?.outcome_id ?? outcome_id };
        }
      } else {
        inMemoryDedupe.set(dedupeKey, { outcome_id });
      }
    }

    if (this.store) {
      await this.store.appendOutcome(event);
    } else {
      inMemoryOutcomes.push(event);
    }
    return event;
  }
}
