/**
 * Phase 5.7 Replay route (postReplayExecution) Unit Tests
 */

import { postReplayExecution } from '../../../../handlers/phase5/autonomy-control-center-routes';

describe('postReplayExecution', () => {
  const actionIntentService = {
    getIntent: jest.fn(),
  };
  const ledgerService = {
    append: jest.fn().mockResolvedValue({}),
  };
  const putReplayEvent = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when body missing required fields', async () => {
    const result = await postReplayExecution(
      actionIntentService as any,
      ledgerService as any,
      putReplayEvent,
      'tenant-1',
      { action_intent_id: '', account_id: 'acc-1', replay_reason: 'r', requested_by: 'u' }
    );
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when intent not found', async () => {
    actionIntentService.getIntent.mockResolvedValue(null);
    const result = await postReplayExecution(
      actionIntentService as any,
      ledgerService as any,
      putReplayEvent,
      'tenant-1',
      { action_intent_id: 'intent-1', account_id: 'acc-1', replay_reason: 'debug', requested_by: 'admin' }
    );
    expect(result.statusCode).toBe(404);
    expect(ledgerService.append).not.toHaveBeenCalled();
    expect(putReplayEvent).not.toHaveBeenCalled();
  });

  it('returns 202 and appends REPLAY_REQUESTED and puts event when intent exists', async () => {
    actionIntentService.getIntent.mockResolvedValue({ action_intent_id: 'intent-1', tenant_id: 'tenant-1', account_id: 'acc-1' });
    const result = await postReplayExecution(
      actionIntentService as any,
      ledgerService as any,
      putReplayEvent,
      'tenant-1',
      { action_intent_id: 'intent-1', account_id: 'acc-1', replay_reason: 'debug', requested_by: 'admin' }
    );
    expect(result.statusCode).toBe(202);
    expect(ledgerService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REPLAY_REQUESTED',
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        data: expect.objectContaining({
          action_intent_id: 'intent-1',
          replay_reason: 'debug',
          requested_by: 'admin',
        }),
      })
    );
    expect(putReplayEvent).toHaveBeenCalledWith({
      action_intent_id: 'intent-1',
      tenant_id: 'tenant-1',
      account_id: 'acc-1',
      replay_reason: 'debug',
      requested_by: 'admin',
    });
  });
});
