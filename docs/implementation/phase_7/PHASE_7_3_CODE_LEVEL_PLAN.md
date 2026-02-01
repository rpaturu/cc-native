# Phase 7.3 — Observability and Dashboards: Code-Level Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.3, Stories 7.3.1–7.3.2  
**Prerequisites:** Phase 7.1 (validator results in ledger); Phase 7.2 (budget decisions in ledger). Metrics can be emitted as soon as validator and budget events exist.

---

## Overview

Phase 7.3 adds **metrics emission** for validator block rate, budget consumption, and existing plan/orchestrator metrics, plus **dashboards and alerting hooks**. No new business logic—observability only. Operators can answer "Is autonomy helping or hurting us?" and "Why was this action blocked or warned?" from dashboards and Plan Ledger (and UI).

**Deliverables:**
- Emit CloudWatch (or equivalent) metrics: ValidatorResultCount (from VALIDATOR_RUN only), ValidatorRunSummaryCount (from VALIDATOR_RUN_SUMMARY only), BudgetResultCount, BudgetUsage/BudgetHardCap (optional for % alarms), GovernanceBlocks/GovernanceWarns; plan outcomes; orchestrator health. **Default: no TenantId/AccountId dimensions** (optional top-offenders mode for BLOCK/WARN only).
- Dashboard definitions: GovernanceImpact, validator block rate, budget consumption, plan outcomes, orchestrator throughput; runbooks with exact query keys (plan_id, event_type, validation_run_id, operation_id).
- Alerting hooks: block rate threshold; budget % alarm only if Cap metric published; runbooks for "why was this blocked?" with executable query keys.

**Dependencies:** Phase 7.1 (ValidatorGateway, Plan Ledger validator events); Phase 7.2 (BudgetService, Plan Ledger budget events). Phase 6 (orchestrator, plan lifecycle) for existing plan metrics.

**Out of scope for 7.3:** New execution logic; adaptive thresholds; auto-remediation; ML-based alerting.

---

## Implementation Tasks

1. Define metric namespaces and dimensions (validator, budget, plan, orchestrator)
2. Emit validator metrics: from **VALIDATOR_RUN** only (counts by validator); from **VALIDATOR_RUN_SUMMARY** only (aggregate decision counts)—use **separate metric names** to avoid double-counting
3. Emit budget metrics: on each BUDGET_RESERVE/BUDGET_BLOCK/BUDGET_WARN, publish count and usage by cost class; **default: no TenantId/AccountId dimensions** (see §1)
4. Emit or aggregate plan metrics: plan success (COMPLETED), pause (PAUSED), abort (ABORTED); orchestrator throughput (plans advanced per run); % human intervention (e.g. approval, pause). **Average time-in-plan: Phase 7.3 baseline = omit from CloudWatch** (compute in Athena/Logs Insights later).
5. CloudWatch Dashboard: create dashboard JSON or CDK construct with widgets for above
6. Alarms: block rate > N per hour; budget % alarm only if Cap metric is published (§4); optional: orchestrator errors
7. Runbooks: document exact query keys for "why was this blocked?" (§5)

---

## 1. Metric Namespaces and Dimensions

**Namespace (canonical):** **`CCNative/Governance`**. Use this namespace only; do not introduce `CCNative/Phase7` or alternate names or dashboards will fragment. Avoid clash with existing Phase 5/6 metrics.

**High-cardinality rule (required):** Emitting TenantId/AccountId per event can blow up CloudWatch costs and hit cardinality limits. **Default:** emit metrics **without** TenantId/AccountId dimensions (global + optional Environment). **Optional "top offenders" mode:** emit TenantId dimension only for BLOCK events (and optionally WARN), and only for a **configured allowlist of tenants** or a **sampling rate**. Do not emit AccountId as a dimension by default. This keeps the metrics system from becoming the expensive thing you're trying to govern.

**Reason not a dimension:** Do **not** add Reason (e.g. DATA_STALE, HARD_CAP_EXCEEDED) as a CloudWatch dimension—too many values, too expensive. Keep reason in Plan Ledger (source of truth) and structured logs only.

**Validator metrics (standardized):**
- **Per-validator counts** (emitted from VALIDATOR_RUN only): metric name **`ValidatorResultCount`**, dimensions `ValidatorName` (freshness, grounding, contradiction, compliance), `Result` (ALLOW, WARN, BLOCK). Value: 1 per emission. Do **not** emit the same counts from VALIDATOR_RUN_SUMMARY—pick one source per metric to avoid double-counting.
- **Aggregate decision counts** (emitted from VALIDATOR_RUN_SUMMARY only): metric name **`ValidatorRunSummaryCount`** (or equivalent), dimension `Aggregate` (ALLOW, WARN, BLOCK). Value: 1 per run. Use for "how many runs blocked/warned" without duplicating per-validator counts.
- Use: metric math to compute block rate = BLOCK count / (ALLOW+WARN+BLOCK) by ValidatorName.

**Budget metrics (standardized):**
- Metric name **`BudgetResultCount`**, dimensions `CostClass` (CHEAP, MEDIUM, EXPENSIVE), `Result` (ALLOW, WARN, BLOCK). Value: 1 per event. Emit on **all** budget decision events (BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN). Default: no TenantId/AccountId dimensions.
- **`BudgetUsage`** and **`BudgetHardCap`**: emit **only on BUDGET_RESERVE** (authoritative usage_after and cap at reserve time). Do **not** emit BudgetUsage/BudgetHardCap on BUDGET_BLOCK or BUDGET_WARN—those events do not have a consistent usage snapshot (no reserve occurred). Use for %-of-cap alarms and CFO dashboards (see §4).
- Use: consumption over time; block/warn counts; optional usage/cap ratio when Cap is published.

**GovernanceImpact (executive):** To avoid mixing different unit types (validator-run vs budget-decision), add dimension **`Source=VALIDATOR|BUDGET`** so one chart can filter or split.
- **`GovernanceBlocks`** — count where aggregate = BLOCK; dimension **`Source`** = VALIDATOR (emit from VALIDATOR_RUN_SUMMARY when aggregate=BLOCK) or BUDGET (emit from BUDGET_BLOCK). Value: 1 per event.
- **`GovernanceWarns`** — count where aggregate = WARN; dimension **`Source`** = VALIDATOR (emit from VALIDATOR_RUN_SUMMARY when aggregate=WARN) or BUDGET (emit from BUDGET_WARN). Value: 1 per event.
- Use: "What % of plans/operations are being blocked or warned by governance?" — filter by Source to avoid misinterpretation ("blocks doubled" could be more budget checks per run).

**Plan metrics (existing or new):**
- Metric name: `PlanOutcomes` or `PlanStatusCount`; dimensions `Status` (COMPLETED, PAUSED, ABORTED, EXPIRED). Default: no TenantId dimension (or optional top-offenders only).
- Value: count per plan transition.

**Orchestrator metrics (existing or new):**
- Metric name: `OrchestratorRuns`, `PlansAdvancedPerRun`, `OrchestratorErrors`; dimensions: Environment only by default.
- Value: count per run; plans advanced per run; error count.

---

## 2. Emission Points

**Observability rule (required):** Metrics emission must be **best-effort** and must **never change execution outcome** if PutMetricData fails. Do not block, retry indefinitely, or fail the governance path when metrics cannot be written. So no accidental governance coupling to observability.

**Validator metrics (no double-counting):**
- **Per-validator counts:** Emit from ValidatorGatewayService **when appending each VALIDATOR_RUN** (one PutMetricData payload per validator result, or batched—see §7). Metric name **ValidatorResultCount**, dimensions ValidatorName + Result, value 1. Do **not** also emit the same counts from VALIDATOR_RUN_SUMMARY.
- **Aggregate run counts:** Emit from ValidatorGatewayService **when appending VALIDATOR_RUN_SUMMARY** only. Metric name **ValidatorRunSummaryCount** (or GovernanceBlocks/GovernanceWarns for BLOCK/WARN runs), dimension Aggregate (ALLOW, WARN, BLOCK), value 1. Separate metric name from per-validator metric.

**Budget metrics:** Emit **BudgetResultCount** (dimensions CostClass + Result, value 1) on **all** budget decision events (BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN). Emit **BudgetUsage** (value = usage_after) and **BudgetHardCap** (value = cap) **only on BUDGET_RESERVE**—that event has the authoritative usage_after; WARN/BLOCK do not reserve, so usage snapshots there would be inconsistent. Default: no TenantId/AccountId dimensions.

**GovernanceImpact:** Emit **GovernanceBlocks** (value 1, dimension **Source=VALIDATOR**) on VALIDATOR_RUN_SUMMARY when aggregate=BLOCK; emit GovernanceBlocks (value 1, dimension **Source=BUDGET**) on BUDGET_BLOCK. Emit **GovernanceWarns** (value 1, dimension **Source=VALIDATOR**) on VALIDATOR_RUN_SUMMARY when aggregate=WARN; emit GovernanceWarns (value 1, dimension **Source=BUDGET**) on BUDGET_WARN. Use Source dimension so dashboards can split validator-run vs budget-decision and avoid misinterpretation.

**Plan metrics:** Emit from PlanLifecycleService (or Plan Ledger consumer) when PLAN_COMPLETED, PLAN_PAUSED, PLAN_ABORTED, PLAN_EXPIRED are appended. Dimensions: Status; value 1.

**Orchestrator metrics:** Emit from PlanOrchestratorService at end of run: PlansAdvancedPerRun, OrchestratorRuns (1), OrchestratorErrors.

**Implementation:** Use AWS SDK CloudWatch PutMetricData or existing metrics utility. **Batch metrics:** PutMetricData accepts up to 20 metrics per call; buffer and flush in batches so that under load (e.g. 4 choke points × 4 validators + summary + budget) you do not emit one API call per validator result. See §7 test strategy.

---

## 3. Dashboard Definition

**Widgets (required for definition of done):**
1. **GovernanceImpact (executive)** — Number or line: GovernanceBlocks and GovernanceWarns over time (filter by **Source=VALIDATOR** or **Source=BUDGET** to split); or % blocked = GovernanceBlocks / (GovernanceBlocks + GovernanceWarns + allowed count).
2. **Validator block rate by type** — Line or number: ValidatorResultCount (Result=BLOCK) per ValidatorName over time; or block rate % per validator (metric math).
3. **Budget consumption by cost class** — Line: BudgetUsage per CostClass over time (BudgetUsage emitted only on BUDGET_RESERVE); when BudgetHardCap is published, show usage/cap ratio.
4. **Budget blocks and warns** — Number or line: BudgetResultCount (Result=BLOCK, Result=WARN) over time.
5. **Plan outcomes** — Pie or bar: COMPLETED vs PAUSED vs ABORTED vs EXPIRED counts.
6. **Orchestrator throughput** — Line: plans advanced per run over time; runs per hour.
7. **Average time-in-plan** — **Phase 7.3 baseline: omit from CloudWatch.** Compute in Athena, Logs Insights, or ad-hoc query when needed. Optional later: emit **TimeInPlanMs** when a plan reaches terminal state (COMPLETED/ABORTED/EXPIRED) if terminal-state handlers make it trivial.
8. **% plans requiring human intervention** — Number: (PAUSED + ABORTED + approval count) / total plans (define in runbook).

**CDK:** Use `cloudwatch.Dashboard` and `cloudwatch.GraphWidget` / `TextWidget` with metrics from the namespace above. Store dashboard in `src/stacks/` or `infrastructure/` as construct.

---

## 4. Alerting Hooks

**Budget % alarm (choose one; no fallback):** CloudWatch metrics do not have config unless you publish the cap. **Option (1):** Publish **BudgetHardCap** alongside BudgetUsage; alarm on metric math `BudgetUsage / BudgetHardCap > 0.8` per CostClass. **Option (2):** Do not publish cap; alarm only on **BudgetResultCount** (Result=BLOCK or WARN) thresholds. **Choose one at deploy time and document;** no runtime fallback between options.

**Alarms (all required for definition of done):**
- **Required — Validator block rate high:** Alarm when ValidatorResultCount (Result=BLOCK) sum over 5 min > N (e.g. 10) for any ValidatorName; or block rate % > X% (metric math). **Required.**
- **Required — Budget block count:** Alarm when BudgetResultCount (Result=BLOCK) > threshold in 5 min (or per product; document threshold). **Required.**
- **Required — Budget cap approached (if Option (1)):** If BudgetHardCap is published, alarm when BudgetUsage / BudgetHardCap > 0.8 (metric math) for a CostClass. **Required** when Option (1) chosen.
- **Required — Orchestrator errors:** Alarm when OrchestratorErrors > 0 in 1 run (or per product threshold). **Required.**

**Actions:** SNS topic → email or Slack; or EventBridge rule for runbook automation. Document in runbook: when alarm fires, query Plan Ledger with exact keys (§5).

---

## 5. Runbooks and Docs

**Document (in repo or wiki) with executable query keys:**

- **"Why was this action blocked?"**
  - Query Plan Ledger by **plan_id** (primary key or index).
  - Filter **event_type IN (VALIDATOR_RUN_SUMMARY, VALIDATOR_RUN, BUDGET_BLOCK, BUDGET_WARN)**.
  - Sort by **timestamp** (or event sk).
  - Group or correlate by **validation_run_id** (validator runs) and **operation_id** (budget) so one run = one story. Read **data.payload** for validator name, result, reason, details; for budget: usage_before, usage_after, cap_hard, matched_configs.
  - Link to UI if Plans API exposes ledger (e.g. GET /plans/:planId/ledger).
- **"Why was this action warned?"** — Same query; filter for events where result = WARN (VALIDATOR_RUN, VALIDATOR_RUN_SUMMARY, BUDGET_WARN).
- **Dashboard interpretation** — What each widget means; normal vs abnormal ranges.

**No new APIs required for 7.3** if Plan Ledger is already queryable by plan_id (Phase 6). Ensure GET /plans/:planId/ledger (or equivalent) returns validator and budget events with validation_run_id and operation_id in payload for navigation.

---

## 6. CDK / Infrastructure

- **CloudWatch namespace:** **CCNative/Governance** (canonical; do not use alternate namespaces).
- **Dashboard:** CDK construct `Phase7Dashboard` or add to existing CCNativeStack; create Dashboard with widgets above.
- **Alarms:** CDK `cloudwatch.Alarm` for validator block rate, budget approach, orchestrator errors; SNS topic for notifications.
- **IAM:** Lambda/services that emit metrics need `cloudwatch:PutMetricData` on the namespace.

---

## 7. Test Strategy (all required)

See **testing/PHASE_7_3_TEST_PLAN.md** for full test plan. All of the following tests are **required** for definition of done. No test is optional.

- **Required — Metrics emission:** Unit test or integration test that invokes ValidatorGateway and BudgetService with known inputs; assert PutMetricData called (or metric log written) with expected namespace, metric names (ValidatorResultCount, BudgetResultCount, etc.), dimensions, and value. Mock CloudWatch if needed. **No double-counting:** assert validator counts emitted from VALIDATOR_RUN only, aggregate from VALIDATOR_RUN_SUMMARY only. **Required.**
- **Required — Batching behavior:** Under load (e.g. one run with 4 validators + summary + budget events), assert that metrics are **batched**—e.g. up to 20 metrics per PutMetricData call—and that the code does **not** emit one API call per validator result. **Required.**
- **Required — Best-effort / no execution impact:** PutMetricData failure does not change execution outcome; no block, no indefinite retry. **Required.**
- **Required — Dashboard:** Smoke test or manual check that dashboard renders and shows data after a few validator/budget events. **Required.**
- **Required — Runbook:** Manual follow-through: trigger a BLOCK, query ledger by plan_id and event_type, sort by time, use validation_run_id/operation_id to group; confirm runbook steps return correct event. **Required.**

---

## References

- Parent: [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)
- Implementation Plan EPIC 7.3: [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)
- Phase 6 Plan Ledger: [../phase_6/PHASE_6_1_CODE_LEVEL_PLAN.md](../phase_6/PHASE_6_1_CODE_LEVEL_PLAN.md) §3
