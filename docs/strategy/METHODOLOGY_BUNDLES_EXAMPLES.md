# METHODOLOGY_BUNDLES_EXAMPLES

This file provides **example Sales Methodology bundles** (MEDDICC, SPIN, Challenger) as JSON objects that conform to `SALES_METHODOLOGY_SCHEMA.md`.

They are designed to be:

* Stored in the **Schema Registry / Config Store**
* Versioned per tenant
* Applied via `MethodologyAssessment` without changing `Opportunity`

> Notes:
>
> * These are **baseline examples**, not canonical "one true" implementations.
> * Customers can customize by creating a new `version` with overrides.
> * Provenance values use `TrustClass` enum: `PRIMARY`, `VERIFIED`, `DERIVED`, `AGENT_INFERENCE`, `UNTRUSTED`

---

## 1) MEDDICC (Baseline)

```json
{
  "methodology_id": "meth:meddicc",
  "name": "MEDDICC",
  "version": "2026-01-v1",
  "tenant_id": "tenant:global",
  "status": "ACTIVE",
  "description": "MEDDICC baseline: Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion, Competition.",
  "dimensions": [
    {
      "dimension_key": "metrics",
      "label": "Metrics",
      "description": "Customer metrics and measurable outcomes are defined.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.15}
    },
    {
      "dimension_key": "economic_buyer",
      "label": "Economic Buyer",
      "description": "Accountable budget owner identified.",
      "critical": true,
      "required": true,
      "field_type": "entity_ref",
      "ref_entity_type": "Contact",
      "min_confidence_autonomous": 0.85,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.15}
    },
    {
      "dimension_key": "decision_criteria",
      "label": "Decision Criteria",
      "description": "Selection criteria are known (technical + commercial).",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.80,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.15}
    },
    {
      "dimension_key": "decision_process",
      "label": "Decision Process",
      "description": "Buying process and steps are known.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 21,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.15}
    },
    {
      "dimension_key": "identify_pain",
      "label": "Identify Pain",
      "description": "Customer pain/problem is explicit and prioritized.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.15}
    },
    {
      "dimension_key": "champion",
      "label": "Champion",
      "description": "An internal advocate is identified.",
      "critical": false,
      "required": true,
      "field_type": "entity_ref",
      "ref_entity_type": "Contact",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.15}
    },
    {
      "dimension_key": "competition",
      "label": "Competition",
      "description": "Competitive alternatives are known (or explicitly none).",
      "critical": false,
      "required": false,
      "field_type": "enum",
      "allowed_values": ["unknown", "none", "identified"],
      "min_confidence_autonomous": 0.65,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED", "AGENT_INFERENCE"],
      "completion_rule": {"type": "enum_match", "exclude": ["unknown"]},
      "score_rule": {"type": "weighted", "weight": 0.10}
    }
  ],
  "scoring_model": {
    "completeness_formula": "count_required",
    "quality_formula": "weighted_sum",
    "freshness_decay": {
      "within_ttl": 1.0,
      "one_x_ttl": 0.5,
      "two_x_ttl": 0.25,
      "beyond_two_x_ttl": 0.1
    },
    "provenance_multipliers": {
      "PRIMARY": 1.0,
      "VERIFIED": 0.95,
      "DERIVED": 0.85,
      "AGENT_INFERENCE": 0.60,
      "UNTRUSTED": 0.30
    }
  },
  "autonomy_gates": {
    "tier_a": {
      "min_completeness": 0.80,
      "min_quality_score": 0.75,
      "required_critical_dimensions_complete": true,
      "disallow_inference_only_for_critical": true
    },
    "tier_b": {
      "min_completeness": 0.50
    },
    "tier_c": {
      "min_completeness": 0.25
    }
  },
  "created_at": "2026-01-22T00:00:00Z",
  "updated_at": "2026-01-22T00:00:00Z"
}
```

---

## 2) SPIN Selling (Baseline)

```json
{
  "methodology_id": "meth:spin",
  "name": "SPIN Selling",
  "version": "2026-01-v1",
  "tenant_id": "tenant:global",
  "status": "ACTIVE",
  "description": "SPIN baseline: Situation, Problem, Implication, Need-Payoff.",
  "dimensions": [
    {
      "dimension_key": "situation",
      "label": "Situation",
      "description": "Current environment is understood (stack, workflows, constraints).",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.70,
      "ttl_days": 60,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.25}
    },
    {
      "dimension_key": "problem",
      "label": "Problem",
      "description": "Pain points / problems are explicit.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.25}
    },
    {
      "dimension_key": "implication",
      "label": "Implication",
      "description": "Consequences of the problem are understood (risk/cost).",
      "critical": false,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.70,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.25}
    },
    {
      "dimension_key": "need_payoff",
      "label": "Need-Payoff",
      "description": "Value hypothesis / desired outcomes are explicit.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.25}
    }
  ],
  "scoring_model": {
    "completeness_formula": "count_required",
    "quality_formula": "weighted_sum",
    "freshness_decay": {
      "within_ttl": 1.0,
      "one_x_ttl": 0.5,
      "two_x_ttl": 0.25,
      "beyond_two_x_ttl": 0.1
    },
    "provenance_multipliers": {
      "PRIMARY": 1.0,
      "VERIFIED": 0.95,
      "DERIVED": 0.85,
      "AGENT_INFERENCE": 0.60,
      "UNTRUSTED": 0.30
    }
  },
  "autonomy_gates": {
    "tier_a": {
      "min_completeness": 0.85,
      "min_quality_score": 0.75,
      "required_critical_dimensions_complete": true,
      "disallow_inference_only_for_critical": true
    },
    "tier_b": {
      "min_completeness": 0.55
    },
    "tier_c": {
      "min_completeness": 0.30
    }
  },
  "created_at": "2026-01-22T00:00:00Z",
  "updated_at": "2026-01-22T00:00:00Z"
}
```

---

## 3) Challenger Sale (Baseline)

This baseline focuses on **insight + mobilizer + commercial teaching**. (It's intentionally minimal and can be expanded.)

```json
{
  "methodology_id": "meth:challenger",
  "name": "Challenger Sale",
  "version": "2026-01-v1",
  "tenant_id": "tenant:global",
  "status": "ACTIVE",
  "description": "Challenger baseline: Commercial insight, Mobilizer, Teach/Tailor/Take Control readiness.",
  "dimensions": [
    {
      "dimension_key": "commercial_insight",
      "label": "Commercial Insight",
      "description": "A differentiated insight is defined and tied to customer business outcomes.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 60,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.35}
    },
    {
      "dimension_key": "mobilizer",
      "label": "Mobilizer",
      "description": "A mobilizer-type stakeholder is identified (drives change).",
      "critical": true,
      "required": true,
      "field_type": "entity_ref",
      "ref_entity_type": "Contact",
      "min_confidence_autonomous": 0.80,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.35}
    },
    {
      "dimension_key": "objection_plan",
      "label": "Objection Plan",
      "description": "Primary objections and handling plan are defined.",
      "critical": false,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.70,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED", "AGENT_INFERENCE"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.30}
    }
  ],
  "scoring_model": {
    "completeness_formula": "count_required",
    "quality_formula": "weighted_sum",
    "freshness_decay": {
      "within_ttl": 1.0,
      "one_x_ttl": 0.5,
      "two_x_ttl": 0.25,
      "beyond_two_x_ttl": 0.1
    },
    "provenance_multipliers": {
      "PRIMARY": 1.0,
      "VERIFIED": 0.95,
      "DERIVED": 0.85,
      "AGENT_INFERENCE": 0.60,
      "UNTRUSTED": 0.30
    }
  },
  "autonomy_gates": {
    "tier_a": {
      "min_completeness": 0.85,
      "min_quality_score": 0.75,
      "required_critical_dimensions_complete": true,
      "disallow_inference_only_for_critical": true
    },
    "tier_b": {
      "min_completeness": 0.55
    },
    "tier_c": {
      "min_completeness": 0.30
    }
  },
  "created_at": "2026-01-22T00:00:00Z",
  "updated_at": "2026-01-22T00:00:00Z"
}
```

---

## 4) Tenant Customization Example (MEDDICC override without touching Opportunity)

Example: A tenant wants MEDDICC but:

* makes `competition` required
* adds a `mutual_plan` dimension
* increases Tier A completeness requirement

```json
{
  "methodology_id": "meth:meddicc",
  "name": "MEDDICC (Acme Custom)",
  "version": "2026-02-acme-v1",
  "tenant_id": "tenant:acme_corp",
  "status": "ACTIVE",
  "description": "Tenant customization of MEDDICC: competition required + mutual plan added.",
  "dimensions": [
    {
      "dimension_key": "metrics",
      "label": "Metrics",
      "description": "Customer metrics and measurable outcomes are defined.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.12}
    },
    {
      "dimension_key": "economic_buyer",
      "label": "Economic Buyer",
      "description": "Accountable budget owner identified.",
      "critical": true,
      "required": true,
      "field_type": "entity_ref",
      "ref_entity_type": "Contact",
      "min_confidence_autonomous": 0.85,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.14}
    },
    {
      "dimension_key": "decision_criteria",
      "label": "Decision Criteria",
      "description": "Selection criteria are known (technical + commercial).",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.80,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.14}
    },
    {
      "dimension_key": "decision_process",
      "label": "Decision Process",
      "description": "Buying process and steps are known.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 21,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.14}
    },
    {
      "dimension_key": "identify_pain",
      "label": "Identify Pain",
      "description": "Customer pain/problem is explicit and prioritized.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 45,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.14}
    },
    {
      "dimension_key": "champion",
      "label": "Champion",
      "description": "An internal advocate is identified.",
      "critical": false,
      "required": true,
      "field_type": "entity_ref",
      "ref_entity_type": "Contact",
      "min_confidence_autonomous": 0.75,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.12}
    },
    {
      "dimension_key": "competition",
      "label": "Competition",
      "description": "Competitive alternatives are explicitly known.",
      "critical": false,
      "required": true,
      "field_type": "enum",
      "allowed_values": ["none", "identified"],
      "min_confidence_autonomous": 0.70,
      "ttl_days": 30,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "enum_match", "values": ["none", "identified"]},
      "score_rule": {"type": "weighted", "weight": 0.10}
    },
    {
      "dimension_key": "mutual_plan",
      "label": "Mutual Plan",
      "description": "A mutual action plan exists and is current.",
      "critical": true,
      "required": true,
      "field_type": "object",
      "min_confidence_autonomous": 0.80,
      "ttl_days": 21,
      "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],
      "completion_rule": {"type": "non_null"},
      "score_rule": {"type": "weighted", "weight": 0.10}
    }
  ],
  "scoring_model": {
    "completeness_formula": "count_required",
    "quality_formula": "weighted_sum",
    "freshness_decay": {
      "within_ttl": 1.0,
      "one_x_ttl": 0.5,
      "two_x_ttl": 0.25,
      "beyond_two_x_ttl": 0.1
    },
    "provenance_multipliers": {
      "PRIMARY": 1.0,
      "VERIFIED": 0.95,
      "DERIVED": 0.85,
      "AGENT_INFERENCE": 0.60,
      "UNTRUSTED": 0.30
    }
  },
  "autonomy_gates": {
    "tier_a": {
      "min_completeness": 0.90,
      "min_quality_score": 0.78,
      "required_critical_dimensions_complete": true,
      "disallow_inference_only_for_critical": true
    },
    "tier_b": {
      "min_completeness": 0.60
    },
    "tier_c": {
      "min_completeness": 0.35
    }
  },
  "created_at": "2026-02-10T00:00:00Z",
  "updated_at": "2026-02-10T00:00:00Z"
}
```

---

## Usage

### As Test Fixtures

These examples can be used as **golden test fixtures** for:

* Methodology validation
* Assessment computation (deterministic outputs)
* Autonomy tier cap calculation
* Schema Registry hash verification

**Location:** `src/tests/fixtures/methodology/`

### As Seed Data

These can be loaded into the Schema Registry as baseline methodologies:

* `meth:meddicc` - Global baseline
* `meth:spin` - Global baseline
* `meth:challenger` - Global baseline

Tenants can then create custom versions by copying and modifying.

### As Documentation

These examples serve as **reference implementations** showing:

* How to structure methodology dimensions
* How to configure autonomy gates
* How to customize for tenant-specific needs
* How to maintain Opportunity methodology-agnostic

---

## Validation

Before using these examples:

1. **Schema Validation**: Verify against `SALES_METHODOLOGY_SCHEMA.md`
2. **Type Validation**: Ensure all fields match `MethodologyTypes.ts`
3. **TrustClass Validation**: Verify `allowed_provenance` uses valid `TrustClass` values
4. **Weight Validation**: Ensure dimension weights sum to ~1.0 (or document why not)
5. **Entity Type Validation**: Verify `ref_entity_type` values exist in `EntityType` enum

---

## Notes

* **Provenance values** have been updated to use `TrustClass` enum: `PRIMARY`, `VERIFIED`, `DERIVED`, `AGENT_INFERENCE`, `UNTRUSTED`
* **Completion rules** use simplified types: `non_null`, `enum_match`, `enum_in`
* **Scoring model** structure matches `MethodologyScoringModel` interface
* **Weights** are normalized (sum to ~1.0) for quality score computation
