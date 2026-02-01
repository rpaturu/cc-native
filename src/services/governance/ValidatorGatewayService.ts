/**
 * Phase 7.1 — ValidatorGateway: run all validators, record all results, aggregate, append to Plan Ledger.
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §2.
 */

import type {
  ValidatorContext,
  ValidatorGatewayResult,
  ValidatorResult,
  ValidatorResultKind,
} from '../../types/governance/ValidatorTypes';
import { PlanLedgerService } from '../plan/PlanLedgerService';
import { Logger } from '../core/Logger';
import { validate as validateFreshness } from './validators/FreshnessValidator';
import { validate as validateGrounding } from './validators/GroundingValidator';
import { validate as validateContradiction } from './validators/ContradictionValidator';
import { validate as validateCompliance } from './validators/ComplianceValidator';
import type { PlanLedgerEventType } from '../../types/plan/PlanLedgerTypes';

const ORDER: Array<(ctx: ValidatorContext) => ValidatorResult> = [
  validateFreshness,
  validateGrounding,
  validateContradiction,
  validateCompliance,
];

function aggregate(results: ValidatorResult[]): ValidatorResultKind {
  if (results.some((r) => r.result === 'BLOCK')) return 'BLOCK';
  if (results.some((r) => r.result === 'WARN')) return 'WARN';
  return 'ALLOW';
}

export interface ValidatorGatewayServiceConfig {
  planLedger: PlanLedgerService;
  logger: Logger;
}

export class ValidatorGatewayService {
  private planLedger: PlanLedgerService;
  private logger: Logger;

  constructor(config: ValidatorGatewayServiceConfig) {
    this.planLedger = config.planLedger;
    this.logger = config.logger;
  }

  async run(context: ValidatorContext): Promise<ValidatorGatewayResult> {
    const results: ValidatorResult[] = [];
    const planId = context.plan_id ?? `_validator_${context.validation_run_id}`;
    const accountId = context.account_id ?? '';

    for (const validateFn of ORDER) {
      const result = validateFn(context);
      results.push(result);

      const eventType: PlanLedgerEventType = 'VALIDATOR_RUN';
      const payload = {
        validation_run_id: context.validation_run_id,
        target_id: context.target_id,
        snapshot_id: context.snapshot_id,
        choke_point: context.choke_point,
        evaluation_time_utc_ms: context.evaluation_time_utc_ms,
        validator: result.validator,
        result: result.result,
        reason: result.reason,
        details: result.details,
        tenant_id: context.tenant_id,
        account_id: context.account_id,
        plan_id: context.plan_id,
        step_id: context.step_id,
      };

      try {
        await this.planLedger.append({
          plan_id: planId,
          tenant_id: context.tenant_id,
          account_id: accountId,
          event_type: eventType,
          data: payload,
        });
      } catch (err) {
        this.logger.warn('ValidatorGateway: ledger append failed for VALIDATOR_RUN', {
          validator: result.validator,
          error: err,
        });
      }
    }

    const agg = aggregate(results);

    const summaryPayload = {
      validation_run_id: context.validation_run_id,
      target_id: context.target_id,
      snapshot_id: context.snapshot_id,
      choke_point: context.choke_point,
      evaluation_time_utc_ms: context.evaluation_time_utc_ms,
      aggregate: agg,
      results,
      tenant_id: context.tenant_id,
      account_id: context.account_id,
      plan_id: context.plan_id,
      step_id: context.step_id,
    };

    let summaryWritten = false;
    try {
      await this.planLedger.append({
        plan_id: planId,
        tenant_id: context.tenant_id,
        account_id: accountId,
        event_type: 'VALIDATOR_RUN_SUMMARY',
        data: summaryPayload,
      });
      summaryWritten = true;
    } catch (err) {
      this.logger.error('ValidatorGateway: VALIDATOR_RUN_SUMMARY append failed', { error: err });
      const synthetic: ValidatorResult = {
        validator: 'gateway',
        result: 'BLOCK',
        reason: 'LEDGER_WRITE_FAILED',
        details: {},
      };
      results.push(synthetic);
    }

    const finalAggregate = summaryWritten ? agg : ('BLOCK' as ValidatorResultKind);
    return {
      aggregate: finalAggregate,
      results,
    };
  }
}
