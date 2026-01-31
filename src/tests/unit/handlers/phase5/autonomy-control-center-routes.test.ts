/**
 * Phase 5.6 Control Center route handlers unit tests.
 */

import {
  resolveTenantFromAuth,
  getKillSwitches,
  putKillSwitches,
  getLedgerExplanation,
  postAuditExports,
  getAuditExportStatus,
} from '../../../../handlers/phase5/autonomy-control-center-routes';

describe('autonomy-control-center-routes', () => {
  describe('resolveTenantFromAuth', () => {
    it('returns custom:tenant_id from claims when present', () => {
      const event = {
        requestContext: {
          authorizer: { claims: { 'custom:tenant_id': 't1' } },
        },
      };
      expect(resolveTenantFromAuth(event)).toBe('t1');
    });

    it('returns tenantId from authorizer when claims tenant_id absent', () => {
      const event = {
        requestContext: {
          authorizer: { tenantId: 't2' },
        },
      };
      expect(resolveTenantFromAuth(event)).toBe('t2');
    });

    it('returns null when no authorizer', () => {
      expect(resolveTenantFromAuth({})).toBeNull();
      expect(resolveTenantFromAuth({ requestContext: {} })).toBeNull();
    });

    it('returns null when authorizer has no claims or tenantId', () => {
      expect(resolveTenantFromAuth({ requestContext: { authorizer: {} } })).toBeNull();
    });
  });

  describe('getKillSwitches', () => {
    it('returns 200 and config from killSwitchService', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        tenant_id: 't1',
        execution_enabled: true,
        disabled_action_types: [],
        global_emergency_stop: false,
      });
      const mockService = { getKillSwitchConfig: mockGet };

      const result = await getKillSwitches(mockService as any, 't1');

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({ tenant_id: 't1', execution_enabled: true });
      expect(mockGet).toHaveBeenCalledWith('t1');
    });
  });

  describe('putKillSwitches', () => {
    it('calls updateKillSwitchConfig and returns 200 with config', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(undefined);
      const mockGet = jest.fn().mockResolvedValue({
        tenant_id: 't1',
        execution_enabled: false,
        disabled_action_types: ['SEND_EMAIL'],
      });
      const mockService = { updateKillSwitchConfig: mockUpdate, getKillSwitchConfig: mockGet };

      const result = await putKillSwitches(mockService as any, 't1', {
        execution_enabled: false,
        disabled_action_types: ['SEND_EMAIL'],
      });

      expect(result.statusCode).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith('t1', {
        execution_enabled: false,
        disabled_action_types: ['SEND_EMAIL'],
      });
      expect(mockGet).toHaveBeenCalledWith('t1');
      expect(JSON.parse(result.body).execution_enabled).toBe(false);
    });
  });

  describe('getLedgerExplanation', () => {
    it('returns 200 and explanation when found', async () => {
      const explanation = {
        execution_id: 'intent-1',
        account_id: 'a1',
        tenant_id: 't1',
        why: { policy_decision: 'AUTO_EXECUTE', explanation: 'OK' },
        which_policy: { policy_version: 'v1' },
      };
      const mockGet = jest.fn().mockResolvedValue(explanation);
      const mockService = { getExplanation: mockGet };

      const result = await getLedgerExplanation(mockService as any, 'intent-1', 't1', 'a1');

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(explanation);
      expect(mockGet).toHaveBeenCalledWith('intent-1', 't1', 'a1');
    });

    it('returns 404 when explanation not found', async () => {
      const mockGet = jest.fn().mockResolvedValue(null);
      const mockService = { getExplanation: mockGet };

      const result = await getLedgerExplanation(mockService as any, 'intent-1', 't1', 'a1');

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).error).toBe('Explanation not found');
    });
  });

  describe('postAuditExports', () => {
    it('returns 202 with export_id and status when from and to provided', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ export_id: 'exp-abc123', status: 'PENDING' });
      const mockService = { createJob: mockCreate };

      const result = await postAuditExports(mockService as any, 't1', {
        from: '2026-01-01',
        to: '2026-01-31',
      });

      expect(result.statusCode).toBe(202);
      expect(JSON.parse(result.body)).toEqual({ export_id: 'exp-abc123', status: 'PENDING' });
      expect(mockCreate).toHaveBeenCalledWith({
        tenant_id: 't1',
        account_id: undefined,
        from: '2026-01-01',
        to: '2026-01-31',
        format: undefined,
      });
    });

    it('passes account_id and format when provided', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ export_id: 'exp-x', status: 'PENDING' });
      const mockService = { createJob: mockCreate };

      await postAuditExports(mockService as any, 't1', {
        from: '2026-01-01',
        to: '2026-01-31',
        account_id: 'a1',
        format: 'csv',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        tenant_id: 't1',
        account_id: 'a1',
        from: '2026-01-01',
        to: '2026-01-31',
        format: 'csv',
      });
    });

    it('returns 400 when from or to missing', async () => {
      const mockService = { createJob: jest.fn() };

      const res1 = await postAuditExports(mockService as any, 't1', { to: '2026-01-31' } as any);
      expect(res1.statusCode).toBe(400);
      expect(JSON.parse(res1.body).error).toContain('from and to required');

      const res2 = await postAuditExports(mockService as any, 't1', { from: '2026-01-01' } as any);
      expect(res2.statusCode).toBe(400);
    });
  });

  describe('getAuditExportStatus', () => {
    it('returns 200 and job when found', async () => {
      const job = {
        export_id: 'exp-abc123',
        status: 'COMPLETED',
        s3_bucket: 'b',
        s3_key: 'k',
      };
      const mockGet = jest.fn().mockResolvedValue(job);
      const mockService = { getJob: mockGet };

      const result = await getAuditExportStatus(mockService as any, 'exp-abc123', 't1');

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({ export_id: 'exp-abc123', status: 'COMPLETED' });
      expect(mockGet).toHaveBeenCalledWith('exp-abc123', 't1');
    });

    it('returns 404 when job not found', async () => {
      const mockGet = jest.fn().mockResolvedValue(null);
      const mockService = { getJob: mockGet };

      const result = await getAuditExportStatus(mockService as any, 'exp-abc123', 't1');

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).error).toBe('Export not found');
    });
  });
});
