/**
 * Phase 6.3 — Plan orchestrator handler unit tests (tenant IDs from Tenants table).
 */

const mockRunCycle = jest.fn();
const mockDynamoSend = jest.fn();

jest.mock('../../../../services/core/Logger');
jest.mock('../../../../utils/aws-client-config', () => ({ getAWSClientConfig: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDynamoSend })) },
  ScanCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
}));
jest.mock('../../../../services/plan/PlanOrchestratorService', () => ({
  PlanOrchestratorService: jest.fn().mockImplementation(() => ({
    runCycle: mockRunCycle,
  })),
}));

describe('plan-orchestrator-handler', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env.TENANTS_TABLE_NAME = 'cc-native-tenants';
    process.env.REVENUE_PLANS_TABLE_NAME = 'RevenuePlans';
    process.env.PLAN_LEDGER_TABLE_NAME = 'PlanLedger';
    process.env.PLAN_STEP_EXECUTION_TABLE_NAME = 'PlanStepExecution';
    process.env.ACTION_INTENT_TABLE_NAME = 'ActionIntent';
    process.env.ORCHESTRATOR_MAX_PLANS_PER_RUN = '10';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    mockRunCycle.mockReset();
    mockDynamoSend.mockReset();
    mockRunCycle.mockResolvedValue({
      activated: 0,
      stepsStarted: 0,
      completed: 0,
      expired: 0,
    });
    mockDynamoSend.mockResolvedValue({ Items: [{ tenantId: 't1' }] });
  });

  it('invokes runCycle for each tenant from Tenants table', async () => {
    const { handler } = await import('../../../../handlers/phase6/plan-orchestrator-handler');
    mockRunCycle.mockResolvedValueOnce({
      activated: 1,
      stepsStarted: 2,
      completed: 0,
      expired: 0,
    });

    await handler({}, {} as never, {} as never);

    expect(mockRunCycle).toHaveBeenCalledWith('t1');
  });

  it('does nothing when no tenants', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });
    const { handler } = await import('../../../../handlers/phase6/plan-orchestrator-handler');

    await handler({}, {} as never, {} as never);

    expect(mockRunCycle).not.toHaveBeenCalled();
  });

  it('throws when TENANTS_TABLE_NAME missing', async () => {
    delete process.env.TENANTS_TABLE_NAME;
    const { handler } = await import('../../../../handlers/phase6/plan-orchestrator-handler');
    await expect(handler({}, {} as never, {} as never)).rejects.toThrow(/TENANTS_TABLE_NAME/);
    process.env.TENANTS_TABLE_NAME = 'cc-native-tenants';
  });

  it('throws when required env missing (e.g. REVENUE_PLANS_TABLE_NAME)', async () => {
    const saved = process.env.REVENUE_PLANS_TABLE_NAME;
    delete process.env.REVENUE_PLANS_TABLE_NAME;
    const { handler } = await import('../../../../handlers/phase6/plan-orchestrator-handler');
    await expect(handler({}, {} as never, {} as never)).rejects.toThrow(
      /REVENUE_PLANS_TABLE_NAME|Missing env/
    );
    process.env.REVENUE_PLANS_TABLE_NAME = saved;
  });

  it('propagates when runCycle throws', async () => {
    const { handler } = await import('../../../../handlers/phase6/plan-orchestrator-handler');
    mockRunCycle.mockRejectedValueOnce(new Error('DB error'));

    await expect(handler({}, {} as never, {} as never)).rejects.toThrow('DB error');
  });
});
