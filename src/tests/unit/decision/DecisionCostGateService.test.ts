/**
 * Unit tests for DecisionCostGateService - Phase 5.2
 */

import { DecisionCostGateService } from '../../../services/decision/DecisionCostGateService';
import type { DecisionCostGateInputV1 } from '../../../types/decision/DecisionTriggerTypes';
import { Logger } from '../../../services/core/Logger';

const logger = new Logger('DecisionCostGateServiceTest');

describe('DecisionCostGateService', () => {
  const service = new DecisionCostGateService(logger);

  const baseInput: DecisionCostGateInputV1 = {
    tenant_id: 't1',
    account_id: 'a1',
    trigger_type: 'SIGNAL_ARRIVED',
    recency_last_run_epoch: undefined,
    budget_remaining: 10,
  };

  it('returns ALLOW when no cooldown and budget remaining', () => {
    const result = service.evaluate(baseInput);
    expect(result.result).toBe('ALLOW');
    expect(result.evaluated_at).toBeDefined();
  });

  it('returns SKIP when budget_remaining is 0', () => {
    const result = service.evaluate({
      ...baseInput,
      budget_remaining: 0,
    });
    expect(result.result).toBe('SKIP');
    expect(result.reason).toBe('BUDGET_EXHAUSTED');
    expect(result.explanation).toContain('budget');
  });

  it('returns DEFER with defer_until_epoch when within cooldown', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const recency = nowEpoch - 60;
    const result = service.evaluate({
      ...baseInput,
      recency_last_run_epoch: recency,
    });
    expect(result.result).toBe('DEFER');
    expect(result.reason).toBe('COOLDOWN');
    expect(result.defer_until_epoch).toBeGreaterThan(nowEpoch);
    expect(result.retry_after_seconds).toBeDefined();
  });

  it('returns ALLOW when recency is beyond cooldown', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const recency = nowEpoch - 400;
    const result = service.evaluate({
      ...baseInput,
      recency_last_run_epoch: recency,
    });
    expect(result.result).toBe('ALLOW');
  });

  it('returns SKIP when action_saturation_score >= 1', () => {
    const result = service.evaluate({
      ...baseInput,
      action_saturation_score: 1,
    });
    expect(result.result).toBe('SKIP');
    expect(result.reason).toBe('MARGINAL_VALUE_LOW');
  });

  it('returns SKIP for unknown trigger type when getRegistryEntry returns null', () => {
    const customService = new DecisionCostGateService(logger, () => null);
    const result = customService.evaluate({
      ...baseInput,
      trigger_type: 'TIME_RITUAL_DAILY_BRIEF',
    });
    expect(result.result).toBe('SKIP');
    expect(result.reason).toBe('UNKNOWN_TRIGGER_TYPE');
  });

  it('same input produces same output (determinism)', () => {
    const input: DecisionCostGateInputV1 = {
      ...baseInput,
      recency_last_run_epoch: Math.floor(Date.now() / 1000) - 100,
    };
    const r1 = service.evaluate(input);
    const r2 = service.evaluate(input);
    expect(r1.result).toBe(r2.result);
    expect(r1.reason).toBe(r2.reason);
  });

  it('returns ALLOW when budget_remaining is undefined (not checked)', () => {
    const result = service.evaluate({
      ...baseInput,
      budget_remaining: undefined,
    });
    expect(result.result).toBe('ALLOW');
  });

  it('returns DEFER with both defer_until_epoch and retry_after_seconds when within cooldown', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const recency = nowEpoch - 100;
    const result = service.evaluate({
      ...baseInput,
      recency_last_run_epoch: recency,
    });
    expect(result.result).toBe('DEFER');
    expect(result.defer_until_epoch).toBeDefined();
    expect(result.retry_after_seconds).toBeDefined();
    expect(result.defer_until_epoch).toBe(recency + 300);
    expect(result.retry_after_seconds).toBe(200);
  });

  it('returns SKIP when budget_remaining is negative', () => {
    const result = service.evaluate({
      ...baseInput,
      budget_remaining: -1,
    });
    expect(result.result).toBe('SKIP');
    expect(result.reason).toBe('BUDGET_EXHAUSTED');
  });

  it('uses default registry for TIME_RITUAL_DAILY_BRIEF and returns ALLOW when no cooldown', () => {
    const result = service.evaluate({
      ...baseInput,
      trigger_type: 'TIME_RITUAL_DAILY_BRIEF',
      recency_last_run_epoch: undefined,
    });
    expect(result.result).toBe('ALLOW');
  });
});
