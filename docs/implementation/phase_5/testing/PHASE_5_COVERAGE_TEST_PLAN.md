# Phase 5 Coverage Test Plan — Core Services

**Status:** 🟡 In progress  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)  
**Scope:** Raise unit coverage for core services used across phases (IdentityService 68.98%, TenantService 80.7%, TraceService 84%, Logger 92.85%). These are cross-cutting; Phase 5 operational readiness is a natural owner.

---

## Current gaps (from PROJECT_TEST_COVERAGE_REVIEW)

| Component | Stmts | Branch | Uncovered focus |
|-----------|-------|--------|-----------------|
| **IdentityService** | 68.98 | 40 | 83–88, 124–129, 140, 171–179, 188–193, 204, 219–224, 229–268, 318–323, 373–378, 414–415, 418–419, 422–423, 426–427, 434–435, 484, 509–510, 513–514, 517–518, 547–552 |
| **TenantService** | 80.7 | 38.88 | 44–48, 84–88, 114–116, 120–122, 127 |
| **TraceService** | 84 | 50 | 35, 81, 86–87 |
| **Logger** | 92.85 | 60 | 53 |

---

## 1. IdentityService

**Test file:** `src/tests/unit/core/IdentityService.test.ts`  
**Source:** `src/services/core/IdentityService.ts`

### Test cases to add

- **83–88, 124–129, 140:** Branches in getIdentity / resolve (e.g. cache hit/miss, missing tenant).
- **171–179, 188–193, 204:** Validation or role-resolution branches.
- **219–224, 229–268:** Cognito or external IDP paths (success, failure, throttling).
- **318–323, 373–378:** Alternative auth flows or fallbacks.
- **414–415, 418–419, 422–423, 426–427, 434–435:** Optional fields or error branches.
- **484, 509–510, 513–514, 517–518, 547–552:** Edge returns or logging branches.

**Strategy:** Inspect source at listed lines; mock Cognito/Secrets Manager where needed; add tests that supply inputs (tenant_id, token, etc.) that hit each branch.

---

## 2. TenantService

**Test file:** `src/tests/unit/core/TenantService.test.ts`  
**Source:** `src/services/core/TenantService.ts`

### Test cases to add

- **44–48, 84–88:** getTenant branches (not found, cache).
- **114–116, 120–122, 127:** listTenants or validation branches.

**Strategy:** Mock DynamoDB; add tests for tenant not found, empty list, optional params.

---

## 3. TraceService

**Test file:** `src/tests/unit/core/TraceService.test.ts`  
**Source:** `src/services/core/TraceService.ts`

### Test cases to add

- **35, 81, 86–87:** generateTraceId or span branches (optional params, different call sites).

**Strategy:** Call generateTraceId / startSpan with various options; assert output and that branches are hit.

---

## 4. Logger

**Test file:** `src/tests/unit/core/Logger.test.ts`  
**Source:** `src/services/core/Logger.ts`

### Test cases to add

- **53:** Branch in log method (e.g. level check or serialization path).

**Strategy:** Call logger with level or context that triggers line 53; confirm in coverage report.

---

## Verification

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

Target: Core services ≥85% statements; IdentityService ≥80% (many branches), TenantService/TraceService/Logger ≥90%.
