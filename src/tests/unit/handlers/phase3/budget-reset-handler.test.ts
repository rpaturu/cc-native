/**
 * Budget Reset Handler Unit Tests - Phase 3
 *
 * Covers: account-specific reset, batch path (not implemented), error propagation.
 */

const mockResetDailyBudget = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../services/decision/CostBudgetService', () => ({
  CostBudgetService: jest.fn().mockImplementation(() => ({
    resetDailyBudget: mockResetDailyBudget,
  })),
}));

import { handler } from '../../../../handlers/phase3/budget-reset-handler';

describe('BudgetResetHandler', () => {
  beforeEach(() => {
    mockResetDailyBudget.mockClear();
  });

  it('should call resetDailyBudget and return { reset: 1 } when event.detail has account_id and tenant_id', async () => {
    const event = {
      detail: { account_id: 'acc1', tenant_id: 't1' },
    };

    const result = await handler(event as any, {} as any, jest.fn());

    expect(mockResetDailyBudget).toHaveBeenCalledTimes(1);
    expect(mockResetDailyBudget).toHaveBeenCalledWith('acc1', 't1');
    expect(result).toEqual({ reset: 1 });
  });

  it('should not call resetDailyBudget and return { reset: 0, message } when event.detail is empty', async () => {
    const event = { detail: {} };

    const result = await handler(event as any, {} as any, jest.fn());

    expect(mockResetDailyBudget).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reset: 0 });
    expect((result as any).message).toContain('Batch reset not implemented');
  });

  it('should not call resetDailyBudget when event has no detail', async () => {
    const event = {};

    const result = await handler(event as any, {} as any, jest.fn());

    expect(mockResetDailyBudget).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reset: 0 });
  });

  it('should propagate error when resetDailyBudget throws', async () => {
    const event = { detail: { account_id: 'acc1', tenant_id: 't1' } };
    mockResetDailyBudget.mockRejectedValueOnce(new Error('DynamoDB error'));

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow('DynamoDB error');
    expect(mockResetDailyBudget).toHaveBeenCalledWith('acc1', 't1');
  });
});
