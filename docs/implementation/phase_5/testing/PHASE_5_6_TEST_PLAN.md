# Phase 5.6 Test Plan — Autonomy Control Center APIs

**Status:** 🟢 **COMPLETE** (unit tests for services, routes, handlers; ~98%+ coverage)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_6_CODE_LEVEL_PLAN.md](../PHASE_5_6_CODE_LEVEL_PLAN.md)

---

## Executive Summary

This document outlines the testing strategy for Phase 5.6 (Autonomy Control Center: kill-switches, ledger explanation, audit export async worker). The plan covers **unit tests for AuditExportService, LedgerExplanationService, KillSwitchService.updateKillSwitchConfig, autonomy-control-center-routes, autonomy-admin-api-handler (5.6 routes), and audit-export-worker-handler**, with a target of **100% coverage** for Phase 5.6 code (types/phase5, services/autonomy AuditExport + LedgerExplanation, handlers/phase5 control-center and audit-export-worker).

**Testing philosophy:**  
Test services in isolation with mocked DynamoDB/Ledger/Outcome; test route helpers with mocked services; test admin handler Phase 5.6 branches (kill-switches, ledger/explanation, audit exports POST/GET, EventBridge emit, presigned URL); test audit export worker with mocked DynamoDB, LedgerService, S3. No integration tests required for this plan (optional later).

### Implementation Status

**✅ Unit tests – AuditExportService: COMPLETE**

- **Test file:** `src/tests/unit/autonomy/AuditExportService.test.ts`
- **Tests:** createJob (returns export_id, status PENDING; PutCommand); getJob (found / null / tenant mismatch); updateJobCompletion (COMPLETED with s3_bucket/s3_key; FAILED with error_message; partial updates).
- **Status:** All passing ✅

**✅ Unit tests – LedgerExplanationService: COMPLETE**

- **Test file:** `src/tests/unit/autonomy/LedgerExplanationService.test.ts`
- **Tests:** getExplanation (null outcome; success with outcome + ledger); deriveWhy branches (policy eval, approved, executed, failed); deriveWhatItKnew (decision snapshot); deriveWhichPolicy (policy_version, policy_clause).
- **Status:** All passing ✅

**✅ Unit tests – KillSwitchService.updateKillSwitchConfig: COMPLETE**

- **Test file:** `src/tests/unit/execution/KillSwitchService.test.ts` (extend existing)
- **Tests:** updateKillSwitchConfig (execution_enabled only; disabled_action_types only; both; UpdateCommand key/expr).
- **Status:** All passing ✅

**✅ Unit tests – autonomy-control-center-routes: COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/autonomy-control-center-routes.test.ts`
- **Tests:** resolveTenantFromAuth (custom:tenant_id; tenantId; null); getKillSwitches (200 + config); putKillSwitches (200 + config); getLedgerExplanation (200 / 404); postAuditExports (202 / 400 missing from/to); getAuditExportStatus (200 / 404).
- **Status:** All passing ✅

**✅ Unit tests – autonomy-admin-api-handler (Phase 5.6): COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/autonomy-admin-api-handler.test.ts` (extend existing)
- **Tests:** GET/PUT /kill-switches (200 when service present; 503 when not configured; 400 tenant missing); GET /ledger/explanation (200/404/400/503); POST /audit/exports (202 + EventBridge emit when EVENT_BUS_NAME set; 503 when not configured); GET /audit/exports/:id (200 with presigned_url when COMPLETED; 404; 503).
- **Status:** All passing ✅

**✅ Unit tests – audit-export-worker-handler: COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/audit-export-worker-handler.test.ts`
- **Tests:** handler invalid detail (missing export_id/tenant_id/from/to) early return; missing env → markFailed; job not found → return; job not PENDING → return; success JSON (LedgerService.query, S3 PutObject, updateJobCompletion COMPLETED); success CSV; failure path → markFailed.
- **Status:** All passing ✅

---

## Test Coverage (reified)

Concrete file paths and coverage targets. Run `npm test -- --testPathPattern=phase5` and `npm test -- --testPathPattern=autonomy` (AuditExportService, LedgerExplanationService) for Phase 5.6 unit tests.

### Phase 5.6 scope (collectCoverageFrom)

| Layer | Path | Target |
|-------|------|--------|
| Types | `src/types/phase5/*.ts` | Via usage |
| Services | `src/services/autonomy/AuditExportService.ts`, `LedgerExplanationService.ts` | 100% |
| Execution | `src/services/execution/KillSwitchService.ts` (updateKillSwitchConfig only) | 100% |
| Routes | `src/handlers/phase5/autonomy-control-center-routes.ts` | 100% |
| Handlers | `src/handlers/phase5/autonomy-admin-api-handler.ts` (5.6 branches), `audit-export-worker-handler.ts` | 100% |

### Coverage summary (achieved)

| Layer | Statements | Branches | Functions | Lines |
|-------|------------|----------|-----------|-------|
| Phase 5.6 services + routes + handlers (above paths) | ~98% | ~80% | ~96% | ~99% |

Run: `npx jest --coverage --testPathIgnorePatterns=integration --collectCoverageFrom='src/services/autonomy/AuditExportService.ts' --collectCoverageFrom='src/services/autonomy/LedgerExplanationService.ts' --collectCoverageFrom='src/handlers/phase5/autonomy-control-center-routes.ts' --collectCoverageFrom='src/handlers/phase5/audit-export-worker-handler.ts' --testPathPattern="(AuditExportService|LedgerExplanationService|autonomy-control-center-routes|autonomy-admin-api-handler|audit-export-worker)"` to reproduce.

---

## Testing Strategy Overview

### 1. Unit tests (implemented)

- **AuditExportService:** Mock DynamoDBDocumentClient. createJob (PutCommand, return export_id/status). getJob (GetCommand; null; tenant_id mismatch). updateJobCompletion (UpdateCommand; COMPLETED with s3_bucket/s3_key; FAILED with error_message; only status + updated_at).
- **LedgerExplanationService:** Mock ExecutionOutcomeService (getOutcome) and ILedgerService (query). getExplanation: null outcome → null; outcome + entries → LedgerExplanationV1. deriveWhy: POLICY_EVALUATED, ACTION_APPROVED, ACTION_EXECUTED, ACTION_FAILED branches. deriveWhatItKnew: DECISION_PROPOSED snapshot. deriveWhichPolicy: policy_version, policy_clause.
- **KillSwitchService:** Add describe('updateKillSwitchConfig') with UpdateCommand; execution_enabled true/false; disabled_action_types; both; key tenantId.
- **autonomy-control-center-routes:** Pure route functions; pass mock services. resolveTenantFromAuth (authorizer.claims['custom:tenant_id'], authorizer.tenantId, no auth). getKillSwitches, putKillSwitches (200). getLedgerExplanation (200 explanation / 404 not found). postAuditExports (202 / 400 from,to). getAuditExportStatus (200 job / 404 not found).
- **autonomy-admin-api-handler:** Set process.env (TENANTS_TABLE_NAME, LEDGER_TABLE_NAME, EXECUTION_OUTCOMES_TABLE_NAME, AUDIT_EXPORT_TABLE_NAME, EVENT_BUS_NAME) and mock KillSwitchService, LedgerExplanationService, AuditExportService (and EventBridge/S3 for audit export). Test /kill-switches GET/PUT, /ledger/explanation GET, /audit/exports POST, /audit/exports/:id GET (presigned URL when COMPLETED). Test 503 when services not configured; 400 when tenant_id missing.
- **audit-export-worker-handler:** Mock LedgerService, AuditExportService, S3 PutObjectCommand. EventBridge event detail valid/invalid; env missing → markFailed; getJob null / not PENDING; success JSON and CSV; throw → markFailed. markFailed calls updateJobCompletion(FAILED).

### 2. Integration tests (optional)

- Control Center API with real API Gateway + Cognito (env-gated).
- Audit export E2E: POST exports → EventBridge → worker → S3 → GET exports/:id presigned URL (env-gated).

### 3. Out of scope for 5.6 test plan

- CDK (AutonomyInfrastructure) — covered by stack tests if any.
- Load or chaos tests.

---

## Execution

- **Phase 5.6 unit tests only:**  
  `npm test -- --testPathPattern="(phase5|autonomy)" --testPathIgnorePattern=integration`
- **Coverage for Phase 5.6:**  
  `npx jest --coverage --testPathIgnorePatterns=integration --collectCoverageFrom='src/types/phase5/**/*.ts' --collectCoverageFrom='src/services/autonomy/AuditExportService.ts' --collectCoverageFrom='src/services/autonomy/LedgerExplanationService.ts' --collectCoverageFrom='src/handlers/phase5/autonomy-control-center-routes.ts' --collectCoverageFrom='src/handlers/phase5/autonomy-admin-api-handler.ts' --collectCoverageFrom='src/handlers/phase5/audit-export-worker-handler.ts' --testPathPattern="(phase5|autonomy)"`

---

## References

- **Code-level plan:** [PHASE_5_6_CODE_LEVEL_PLAN.md](../PHASE_5_6_CODE_LEVEL_PLAN.md)
- **Coverage plan:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)
- **Phase 5.5 test plan:** [PHASE_5_5_TEST_PLAN.md](./PHASE_5_5_TEST_PLAN.md)
