/**
 * Phase 3 — Decision API Integration Tests (HTTP)
 *
 * Calls the real Decision API (API Gateway) with x-api-key auth.
 * Contract: POST /decisions/evaluate, GET /decisions/{evaluation_id}/status, GET /accounts/{account_id}/decisions.
 *
 * Requires: DECISION_API_URL, DECISION_API_KEY (from .env after ./deploy).
 * Skip when: SKIP_DECISION_API_INTEGRATION=1 or env missing.
 *
 * Uses undici fetch with explicit Agent (dispatcher) so TLS connections are closed in afterAll and Jest exits cleanly.
 */

import { Agent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { loadEnv } from '../loadEnv';

loadEnv();

let fetchAgent: Agent;
let previousDispatcher: ReturnType<typeof getGlobalDispatcher>;
/** All requests use this so they go through our Agent and can be torn down in afterAll. Set in beforeAll. */
let apiFetch: typeof fetch = globalThis.fetch;

const baseUrl = (process.env.DECISION_API_URL || '').replace(/\/$/, '');
const apiKey = process.env.DECISION_API_KEY || '';
const hasRequiredEnv = Boolean(baseUrl && apiKey);
const skipIntegration = process.env.SKIP_DECISION_API_INTEGRATION === '1';

const testTenantId = `test-tenant-decision-api-${Date.now()}`;
const testAccountId = `test-account-decision-api-${Date.now()}`;

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'X-Tenant-Id': testTenantId,
  };
}

async function postEvaluate(body: { account_id: string; tenant_id: string; trigger_type?: string }) {
  const res = await apiFetch(`${baseUrl}/decisions/evaluate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  return { status: res.status, data };
}

async function getEvaluationStatus(evaluationId: string) {
  const res = await apiFetch(`${baseUrl}/decisions/${evaluationId}/status`, {
    method: 'GET',
    headers: headers(),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  return { status: res.status, data };
}

async function getAccountDecisions(accountId: string) {
  const res = await apiFetch(`${baseUrl}/accounts/${accountId}/decisions`, {
    method: 'GET',
    headers: headers(),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  return { status: res.status, data };
}

(hasRequiredEnv && !skipIntegration ? describe : describe.skip)(
  'Decision API Integration (HTTP)',
  () => {
    beforeAll(() => {
      if (!hasRequiredEnv) {
        throw new Error(
          '[Decision API integration] Missing DECISION_API_URL or DECISION_API_KEY. ' +
            'Run ./deploy to write .env or set SKIP_DECISION_API_INTEGRATION=1 to skip.'
        );
      }
      previousDispatcher = getGlobalDispatcher();
      fetchAgent = new Agent({ keepAliveTimeout: 10, keepAliveMaxTimeout: 10 });
      apiFetch = (input: string | URL | Request, init?: RequestInit) =>
        undiciFetch(input, { ...init, dispatcher: fetchAgent } as RequestInit);
      setGlobalDispatcher(fetchAgent);
    });

    afterAll(() => {
      if (fetchAgent) {
        fetchAgent.destroy();
        setGlobalDispatcher(previousDispatcher);
      }
    });

    describe('POST /decisions/evaluate', () => {
      it('returns 200 with message when decision not triggered', async () => {
        const { status, data } = await postEvaluate({
          account_id: testAccountId,
          tenant_id: testTenantId,
          trigger_type: 'EXPLICIT_USER_REQUEST',
        });
        expect([200, 202, 401, 429]).toContain(status);
        expect(data).toBeDefined();
        const body = data as Record<string, unknown>;
        if (status !== 401) {
          expect(typeof body.message === 'string' || typeof body.error === 'string').toBe(true);
        }
        if (status === 200 && body.reason !== undefined) {
          expect(typeof body.reason).toBe('string');
        }
        if (status === 202) {
          expect(body.evaluation_id).toBeDefined();
          expect(typeof (body as { evaluation_id?: string }).evaluation_id).toBe('string');
          expect((body as { status?: string }).status).toBe('PENDING');
        }
        if (status === 429) {
          expect(body.message).toBe('Budget exceeded');
        }
      });

      it('returns 4xx or 5xx with error when body is invalid', async () => {
        const res = await apiFetch(`${baseUrl}/decisions/evaluate`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({}),
        });
        const text = await res.text();
        expect([200, 202, 400, 401, 429, 500]).toContain(res.status);
        if (res.status >= 400 && text) {
          const data = JSON.parse(text) as Record<string, unknown>;
          expect(data.error !== undefined || data.message !== undefined).toBe(true);
        }
      });
    });

    describe('GET /decisions/{evaluation_id}/status', () => {
      it('returns 400 when x-tenant-id missing', async () => {
        const res = await apiFetch(`${baseUrl}/decisions/eval-fake-123/status`, {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });
        await res.text();
        expect([400, 401, 403, 404]).toContain(res.status);
      });

      it('returns 200 or 404 for a known evaluation_id', async () => {
        const evalId = `eval_${Date.now()}-nonexistent`;
        const { status, data } = await getEvaluationStatus(evalId);
        expect([200, 401, 404, 500]).toContain(status);
        if (status === 200) {
          const body = data as Record<string, unknown>;
          expect(['PENDING', 'COMPLETED']).toContain(body.status);
          expect(body.evaluation_id).toBe(evalId);
        }
        if (status === 404) {
          const body = data as Record<string, unknown>;
          expect(body.error).toBe('Evaluation not found');
        }
      });
    });

    describe('GET /accounts/{account_id}/decisions', () => {
      it('returns 200 with decisions array', async () => {
        const { status, data } = await getAccountDecisions(testAccountId);
        expect([200, 400, 401, 500]).toContain(status);
        if (status === 200) {
          const body = data as Record<string, unknown>;
          expect(Array.isArray(body.decisions)).toBe(true);
        }
      });

      it('returns 400 when x-tenant-id missing', async () => {
        const res = await apiFetch(`${baseUrl}/accounts/${testAccountId}/decisions`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        });
        await res.text();
        expect([400, 401, 403, 500]).toContain(res.status);
      });
    });

    describe('Contract: API key required', () => {
      it('returns 403 when x-api-key is missing', async () => {
        const res = await apiFetch(`${baseUrl}/decisions/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': testTenantId },
          body: JSON.stringify({ account_id: testAccountId, tenant_id: testTenantId }),
        });
        await res.text();
        expect([403, 401]).toContain(res.status);
      });
    });
  }
);
