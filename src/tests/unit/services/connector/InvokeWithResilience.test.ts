/**
 * InvokeWithResilience Unit Tests - Phase 5.7
 */

import { invokeWithResilience, connectorIdFromToolName } from '../../../../services/connector/InvokeWithResilience';
import { Logger } from '../../../../services/core/Logger';

describe('connectorIdFromToolName', () => {
  it('returns internal for internal.*', () => {
    expect(connectorIdFromToolName('internal.create_task')).toBe('internal');
  });
  it('returns crm_salesforce for crm.*', () => {
    expect(connectorIdFromToolName('crm.create_task')).toBe('crm_salesforce');
  });
  it('returns calendar for calendar.*', () => {
    expect(connectorIdFromToolName('calendar.schedule')).toBe('calendar');
  });
  it('returns first segment for unknown prefix', () => {
    expect(connectorIdFromToolName('custom.foo')).toBe('custom');
  });
  it('returns unknown when tool name has no leading segment (e.g. .only)', () => {
    expect(connectorIdFromToolName('.only')).toBe('unknown');
  });
});

describe('invokeWithResilience', () => {
  const logger = new Logger('InvokeWithResilienceTest');

  it('returns success when fn resolves', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: true }),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    const concurrency = {
      tryAcquire: jest.fn().mockResolvedValue({ acquired: true }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const metrics = { emit: jest.fn().mockResolvedValue(undefined) };
    const result = await invokeWithResilience(
      'internal.create_task',
      'tenant-1',
      'internal',
      'phase4_execution',
      async () => 'ok',
      { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
    );
    expect(result.kind).toBe('success');
    expect((result as any).value).toBe('ok');
    expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('internal');
    expect(concurrency.release).toHaveBeenCalledWith('internal');
  });

  it('returns defer when circuit allows false', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 15 }),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const concurrency = { tryAcquire: jest.fn(), release: jest.fn() };
    const metrics = { emit: jest.fn() };
    const result = await invokeWithResilience(
      'internal.create_task',
      'tenant-1',
      'internal',
      'phase5_perception',
      async () => 'ok',
      { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
    );
    expect(result.kind).toBe('defer');
    expect((result as any).retryAfterSeconds).toBe(15);
    expect(concurrency.tryAcquire).not.toHaveBeenCalled();
  });

  it('throws CircuitBreakerOpenError for phase4_execution when OPEN', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 10 }),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const concurrency = { tryAcquire: jest.fn(), release: jest.fn() };
    const metrics = { emit: jest.fn() };
    await expect(
      invokeWithResilience(
        'internal.create_task',
        'tenant-1',
        'internal',
        'phase4_execution',
        async () => 'ok',
        { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
      )
    ).rejects.toMatchObject({ name: 'CircuitBreakerOpenError' });
  });

  it('uses default retryAfterSeconds for phase4 when allow has no retryAfterSeconds', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: false }),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const concurrency = { tryAcquire: jest.fn(), release: jest.fn() };
    const metrics = { emit: jest.fn() };
    await expect(
      invokeWithResilience(
        'internal.create_task',
        'tenant-1',
        'internal',
        'phase4_execution',
        async () => 'ok',
        { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
      )
    ).rejects.toMatchObject({
      name: 'CircuitBreakerOpenError',
      message: expect.stringContaining('Retry after 30s'),
    });
  });

  it('uses default retryAfterSeconds for phase5 when allow has no retryAfterSeconds', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: false }),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const concurrency = { tryAcquire: jest.fn(), release: jest.fn() };
    const metrics = { emit: jest.fn() };
    const result = await invokeWithResilience(
      'internal.create_task',
      'tenant-1',
      'internal',
      'phase5_perception',
      async () => 'ok',
      { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
    );
    expect(result.kind).toBe('defer');
    expect((result as any).retryAfterSeconds).toBe(30);
  });

  it('uses default retryAfterSeconds when concurrency not acquired and no retryAfterSeconds', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: true }),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const concurrency = {
      tryAcquire: jest.fn().mockResolvedValue({ acquired: false }),
      release: jest.fn(),
    };
    const metrics = { emit: jest.fn() };
    const result = await invokeWithResilience(
      'internal.create_task',
      'tenant-1',
      'internal',
      'phase4_execution',
      async () => 'ok',
      { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
    );
    expect(result.kind).toBe('defer');
    expect((result as any).retryAfterSeconds).toBe(30);
  });

  it('returns defer when concurrency tryAcquire not acquired', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: true }),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const concurrency = {
      tryAcquire: jest.fn().mockResolvedValue({ acquired: false, retryAfterSeconds: 8 }),
      release: jest.fn(),
    };
    const metrics = { emit: jest.fn() };
    const result = await invokeWithResilience(
      'internal.create_task',
      'tenant-1',
      'internal',
      'phase4_execution',
      async () => 'ok',
      { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
    );
    expect(result.kind).toBe('defer');
    expect((result as any).retryAfterSeconds).toBe(8);
    expect(metrics.emit).not.toHaveBeenCalled();
  });

  it('records failure and rethrows when fn throws', async () => {
    const circuitBreaker = {
      allowRequest: jest.fn().mockResolvedValue({ allowed: true }),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    const concurrency = {
      tryAcquire: jest.fn().mockResolvedValue({ acquired: true }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const metrics = { emit: jest.fn().mockResolvedValue(undefined) };
    const err = new Error('Connector error');
    await expect(
      invokeWithResilience(
        'internal.create_task',
        'tenant-1',
        'internal',
        'phase4_execution',
        async () => {
          throw err;
        },
        { circuitBreaker: circuitBreaker as any, concurrency: concurrency as any, metrics: metrics as any, logger }
      )
    ).rejects.toThrow('Connector error');
    expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('internal');
    expect(metrics.emit).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'internal.create_task', connectorId: 'internal', success: false })
    );
    expect(concurrency.release).toHaveBeenCalledWith('internal');
  });
});
