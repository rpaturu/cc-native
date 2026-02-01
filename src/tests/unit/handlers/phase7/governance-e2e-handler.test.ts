/**
 * Phase 7 E2E — Governance E2E handler unit tests.
 *
 * Ensures budget_reserve path appends BUDGET_RESERVE to Plan Ledger (default period_key
 * must match default budget config so applicable config exists; would catch period_key
 * length 7 => MONTH => no config => no append bug found at E2E).
 */

jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: jest.fn() }) },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

const mockAppend = jest.fn().mockResolvedValue({ entry_id: 'e1', timestamp: new Date().toISOString() });

jest.mock('../../../../services/plan/PlanLedgerService', () => ({
  PlanLedgerService: jest.fn().mockImplementation(() => ({ append: mockAppend })),
}));

import { handler } from '../../../../handlers/phase7/governance-e2e-handler';

const mockContext = {} as any;

async function invoke(event: { body?: string }): Promise<{ statusCode: number; body: string }> {
  const res = await (handler as (event: any, context?: any) => Promise<{ statusCode: number; body: string } | void>)(event as any, mockContext);
  expect(res).toBeDefined();
  return res!;
}

describe('governance-e2e-handler', () => {
  beforeAll(() => {
    process.env.PLAN_LEDGER_TABLE_NAME = 'test-plan-ledger';
    process.env.AWS_REGION = 'us-east-1';
  });

  beforeEach(() => {
    mockAppend.mockClear();
  });

  it('returns 500 when PLAN_LEDGER_TABLE_NAME is not set', async () => {
    const orig = process.env.PLAN_LEDGER_TABLE_NAME;
    delete process.env.PLAN_LEDGER_TABLE_NAME;
    const res = await invoke({ body: JSON.stringify({ action: 'budget_reserve', plan_id: 'p1', tenant_id: 't1' }) });
    process.env.PLAN_LEDGER_TABLE_NAME = orig;
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('PLAN_LEDGER_TABLE_NAME');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const res = await invoke({ body: 'not json' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Invalid JSON');
  });

  it('returns 400 when action is not budget_reserve', async () => {
    const res = await invoke({ body: JSON.stringify({ action: 'other', plan_id: 'p1', tenant_id: 't1' }) });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('action must be budget_reserve');
  });

  it('returns 400 when plan_id or tenant_id missing', async () => {
    const res = await invoke({ body: JSON.stringify({ action: 'budget_reserve', tenant_id: 't1' }) });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('plan_id and tenant_id required');
  });

  it('returns 200 and appends BUDGET_RESERVE to ledger for valid budget_reserve (default period_key => DAY config)', async () => {
    const res = await invoke({
      body: JSON.stringify({ action: 'budget_reserve', plan_id: 'p1', tenant_id: 't1' }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(['ALLOW', 'WARN', 'BLOCK']).toContain(body.result);

    expect(mockAppend).toHaveBeenCalled();
    const appendCalls = mockAppend.mock.calls as Array<[{ event_type: string }]>;
    const budgetReserveCall = appendCalls.find((c) => c[0]?.event_type === 'BUDGET_RESERVE');
    expect(budgetReserveCall).toBeDefined();
  });

  it('appends BUDGET_RESERVE when period_key is DAY format (length 10)', async () => {
    mockAppend.mockClear();
    const res = await invoke({
      body: JSON.stringify({
        action: 'budget_reserve',
        plan_id: 'p1',
        tenant_id: 't1',
        period_key: '2026-01-31',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockAppend).toHaveBeenCalled();
    const appendCalls = mockAppend.mock.calls as Array<[{ event_type: string }]>;
    expect(appendCalls.some((c) => c[0]?.event_type === 'BUDGET_RESERVE')).toBe(true);
  });
});
