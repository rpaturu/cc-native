/**
 * Phase 7.3 — Governance metrics emission unit tests.
 * See PHASE_7_3_TEST_PLAN.md §1–§3, §5.
 */

import {
  emitValidatorResult,
  emitValidatorRunSummary,
  emitBudgetResult,
} from '../../../services/governance/GovernanceMetricsEmitter';
import { Logger } from '../../../services/core/Logger';

const logger = new Logger('GovernanceMetricsTest');

describe('GovernanceMetricsEmitter', () => {
  const NAMESPACE = 'CCNative/Governance';

  describe('namespace and metric names', () => {
    it('emitValidatorResult uses ValidatorResultCount and CCNative/Governance', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitValidatorResult({ logger, putMetricData }, 'freshness', 'ALLOW');
      await new Promise((r) => setImmediate(r));
      expect(putMetricData).toHaveBeenCalledWith(
        NAMESPACE,
        expect.arrayContaining([
          expect.objectContaining({ name: 'ValidatorResultCount', value: 1, dimensions: { ValidatorName: 'freshness', Result: 'ALLOW' } }),
        ])
      );
    });

    it('emitValidatorRunSummary uses ValidatorRunSummaryCount', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitValidatorRunSummary({ logger, putMetricData }, 'WARN');
      await new Promise((r) => setImmediate(r));
      expect(putMetricData).toHaveBeenCalledWith(
        NAMESPACE,
        expect.arrayContaining([
          expect.objectContaining({ name: 'ValidatorRunSummaryCount', value: 1, dimensions: { Aggregate: 'WARN' } }),
        ])
      );
    });

    it('emitValidatorRunSummary emits GovernanceBlocks when aggregate BLOCK', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitValidatorRunSummary({ logger, putMetricData }, 'BLOCK');
      await new Promise((r) => setImmediate(r));
      const calls = putMetricData.mock.calls[0][1];
      expect(calls.some((m: { name: string }) => m.name === 'GovernanceBlocks')).toBe(true);
      expect(calls.find((m: { name: string }) => m.name === 'GovernanceBlocks')?.dimensions?.Source).toBe('VALIDATOR');
    });

    it('emitValidatorRunSummary emits GovernanceWarns when aggregate WARN', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitValidatorRunSummary({ logger, putMetricData }, 'WARN');
      await new Promise((r) => setImmediate(r));
      const calls = putMetricData.mock.calls[0][1];
      expect(calls.some((m: { name: string }) => m.name === 'GovernanceWarns')).toBe(true);
    });

    it('emitBudgetResult uses BudgetResultCount; BudgetUsage/BudgetHardCap only when provided', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitBudgetResult({ logger, putMetricData }, 'EXPENSIVE', 'ALLOW', 10, 50);
      await new Promise((r) => setImmediate(r));
      const metrics = putMetricData.mock.calls[0][1];
      expect(metrics.some((m: { name: string }) => m.name === 'BudgetResultCount')).toBe(true);
      expect(metrics.some((m: { name: string }) => m.name === 'BudgetUsage')).toBe(true);
      expect(metrics.some((m: { name: string }) => m.name === 'BudgetHardCap')).toBe(true);
    });

    it('emitBudgetResult for BLOCK emits GovernanceBlocks with Source BUDGET', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitBudgetResult({ logger, putMetricData }, 'EXPENSIVE', 'BLOCK');
      await new Promise((r) => setImmediate(r));
      const metrics = putMetricData.mock.calls[0][1];
      const blocks = metrics.find((m: { name: string }) => m.name === 'GovernanceBlocks');
      expect(blocks?.dimensions?.Source).toBe('BUDGET');
    });
  });

  describe('dimensions and values', () => {
    it('ValidatorResultCount has ValidatorName and Result; value 1', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitValidatorResult({ logger, putMetricData }, 'grounding', 'WARN');
      await new Promise((r) => setImmediate(r));
      const m = putMetricData.mock.calls[0][1][0];
      expect(m.dimensions?.ValidatorName).toBe('grounding');
      expect(m.dimensions?.Result).toBe('WARN');
      expect(m.value).toBe(1);
    });

    it('BudgetResultCount has CostClass and Result', async () => {
      const putMetricData = jest.fn().mockResolvedValue(undefined);
      emitBudgetResult({ logger, putMetricData }, 'MEDIUM', 'ALLOW');
      await new Promise((r) => setImmediate(r));
      const m = putMetricData.mock.calls[0][1][0];
      expect(m.dimensions?.CostClass).toBe('MEDIUM');
      expect(m.dimensions?.Result).toBe('ALLOW');
    });
  });

  describe('best-effort: PutMetricData failure does not throw', () => {
    it('emitValidatorResult does not throw when putMetricData rejects', async () => {
      const putMetricData = jest.fn().mockRejectedValue(new Error('CloudWatch error'));
      expect(() => emitValidatorResult({ logger, putMetricData }, 'freshness', 'ALLOW')).not.toThrow();
      await new Promise((r) => setTimeout(r, 50));
    });

    it('emitBudgetResult does not throw when putMetricData rejects', async () => {
      const putMetricData = jest.fn().mockRejectedValue(new Error('CloudWatch error'));
      expect(() => emitBudgetResult({ logger, putMetricData }, 'EXPENSIVE', 'ALLOW')).not.toThrow();
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
