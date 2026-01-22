# SALES_METHODOLOGY_SCHEMA

## 1. Purpose

This document defines how Manus models **sales methodologies** (MEDDICC, SPIN, Challenger, etc.) as **first-class configuration**.

Goal:

* Support customer-specific methodology choices and customization
* Avoid polluting core entities (especially `Opportunity`) with methodology-specific fields
* Enable deterministic validation, confidence gating, and auditability

A methodology is not a CRM schema fork. It is a **policy + field overlay** applied to an Opportunity.

---

## 2. Core Principle

> **Opportunity is methodology-agnostic.**

Methodologies are modeled as:

1. `SalesMethodology` — the definition (what to evaluate)
2. `MethodologyAssessment` — the instance (evaluation of one opportunity)

---

## 3. Entities

### 3.1 SalesMethodology (Definition Entity)

Represents the authoritative definition of a methodology.

**Identity:**

* `methodology_id` (stable)
* `version` (monotonic, e.g., `2026-01-v1`)

**Key Outputs:**

* required dimensions
* field definitions
* scoring + completeness rules
* autonomy gating rules

**Entity Type:** `SalesMethodology` (registered in `WORLD_STATE_SCHEMA_V1.md`)

---

## 4. SalesMethodology Schema (Canonical)

### 4.1 Required Fields

| Field            | Type   | Required | Notes                               |
| ---------------- | ------ | -------: | ----------------------------------- |
| `methodology_id` | string |        ✅ | Stable ID (tenant-scoped or global) |
| `name`           | string |        ✅ | e.g., MEDDICC                       |
| `version`        | string |        ✅ | Schema registry version             |
| `tenant_id`      | string |        ✅ | Tenant boundary                     |
| `status`         | enum   |        ✅ | ACTIVE/DEPRECATED/DRAFT             |
| `description`    | string |        ❌ | Human-readable                      |
| `dimensions`     | list   |        ✅ | Methodology dimensions (see 4.2)    |
| `scoring_model`  | object |        ✅ | How to compute completeness / score |
| `autonomy_gates` | object |        ✅ | Tier gating rules                   |
| `created_at`     | date   |        ✅ | Audit                               |
| `updated_at`     | date   |        ✅ | Audit                               |

---

### 4.2 Dimension Definition

A methodology is a list of **dimensions**.

Each dimension defines:

* what question is being answered
* expected evidence and freshness
* how to score completeness

**Dimension object:**

```json
{
  "dimension_key": "economic_buyer",
  "label": "Economic Buyer",
  "description": "Identified accountable budget owner",
  "critical": true,
  "required": true,

  "field_type": "entity_ref",
  "allowed_values": null,
  "ref_entity_type": "Contact",

  "min_confidence_autonomous": 0.85,
  "ttl_days": 30,
  "allowed_provenance": ["PRIMARY", "VERIFIED", "DERIVED"],

  "completion_rule": {
    "type": "non_null"
  },

  "score_rule": {
    "type": "weighted",
    "weight": 0.15
  }
}
```

**Supported `field_type` values (v1):**

* `boolean`
* `enum`
* `string`
* `number`
* `entity_ref` (e.g., Contact)
* `list_entity_ref`
* `object`

---

## 5. Scoring Model

The scoring model computes two values:

* **Completeness**: percent of required dimensions completed
* **Quality Score**: weighted score of dimensions completed with sufficient confidence

### 5.1 Completeness

**Computation Formula:**
```
completeness = COUNT(dimensions where:
  value != null AND
  confidence >= min_confidence_autonomous AND
  freshness <= ttl_days AND
  provenance in allowed_provenance
) / COUNT(required_dimensions)
```

Minimum rules:

* Required dimensions must be non-null
* Required dimensions must satisfy min-confidence thresholds
* Freshness must be within TTL

### 5.2 Quality Score

**Computation Formula:**
```
quality_score = SUM(
  dimension.weight * (
    dimension.confidence *
    freshness_multiplier(dimension.freshness, dimension.ttl_days) *
    provenance_multiplier(dimension.provenance_trust)
  )
) / SUM(dimension.weight for all dimensions)
```

Where:
* `freshness_multiplier(freshness_hours, ttl_days)`: `1.0` if within TTL, `0.5` if 1x TTL, `0.25` if 2x TTL, `0.1` if >2x TTL
* `provenance_multiplier(trust_class)`: `1.0` for PRIMARY/VERIFIED, `0.85` for DERIVED, `0.60` for AGENT_INFERENCE

Weighted sum of dimension scores, where a dimension contributes only if:

* dimension completion is satisfied
* confidence meets thresholds
* provenance is acceptable

---

## 6. Autonomy Gates (Methodology-Driven)

Methodology can restrict what agents are allowed to do.

**Autonomy gates map to tiers A/B/C/D from `AGENT_READ_POLICY.md`.**

Example:

```json
{
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
}
```

### 6.1 Tier Cap Enforcement

**Hard rule:**

* Methodology autonomy gates may only **tighten** global policy, not loosen it.

**Enforcement Algorithm:**
```
final_tier = MIN(
  global_agent_read_policy_tier,
  methodology_recommended_tier_cap
)
```

**Examples:**
* If methodology cap is Tier C and global policy allows Tier A → agent gets Tier C
* If methodology cap is Tier A and global policy allows Tier C → agent gets Tier C (global minimum)
* Methodology gates are applied as **caps**, not overrides

---

## 7. Customization Model (Tenant-Safe)

A tenant may customize a methodology via:

* adding dimensions
* changing weights
* changing required/critical flags
* adjusting TTLs and min confidence

Rules:

* Customizations create a new `version`
* Version format: `{methodology_id}-{tenant_id}-{YYYY-MM-DD}-v{N}` for tenant customizations, `{methodology_id}-global-{YYYY-MM-DD}-v{N}` for global versions
* Previous versions remain readable
* Historical assessments preserve their referenced methodology version

---

## 8. Integration With Schema Registry

`SalesMethodology` is itself stored in the Schema Registry / Config Store.

### 8.1 Schema Registry Storage

**S3 Storage:**
* Path: `s3://cc-native-schema-registry/{version}/SalesMethodology-{methodology_id}.json`
* Object Lock: Enabled (immutable)
* Versioning: Enabled

**DynamoDB Index:**
* Table: `cc-native-schema-registry`
* Primary Key: `pk = SCHEMA#SalesMethodology`, `sk = VERSION#{version}#{schemaHash}`
* GSI1: `gsi1pk = METHODOLOGY#{methodology_id}`, `gsi1sk = {version}`

**Hash Verification:**
* Schema JSON is hashed (SHA-256) before storage
* Hash stored in DynamoDB: `schemaHash`
* On read: verify computed hash matches stored hash (fail-closed)

**Version Resolution:**
* Agents resolve `methodology_id` + `version` → schema hash lookup
* Missing methodology version ⇒ Tier D (fail-safe)

**Fail-Closed Rule:**
* Missing methodology version in Schema Registry = Tier D
* Hash mismatch = Tier D
* Invalid dimension keys = Tier D

Agents MUST:

* read the methodology version referenced by an assessment
* validate dimension keys exist
* validate scoring and gate rules deterministically

---

## 9. Evidence & Provenance Requirements

Dimensions require explicit provenance.

For **critical** dimensions:

* provenance must not be inference-only
* missing provenance ⇒ dimension incomplete

**Provenance Format:**
Dimensions use `EvidenceRef` format (from `CommonTypes.ts`):
```typescript
interface EvidenceRef {
  type: 's3' | 'crm' | 'transcript' | 'external';
  location: string;  // S3 key, CRM ID, etc.
  timestamp?: string;
}
```

Example:
```json
"dimension_provenance": {
  "economic_buyer": [
    {"type": "crm", "location": "contact_role:123", "timestamp": "2026-01-10T00:00:00Z"}
  ],
  "decision_process": [
    {"type": "transcript", "location": "s3://.../transcript-2026-01-15.json", "timestamp": "2026-01-15T00:00:00Z"}
  ]
}
```

---

## 10. Examples

### 10.1 MEDDICC (Baseline)

Suggested baseline dimension keys:

* `metrics`
* `economic_buyer`
* `decision_criteria`
* `decision_process`
* `identify_pain`
* `champion`
* `competition`

This baseline is a starting point; tenants may customize.

---

## 11. Summary

This schema lets Manus support methodology choice without CRM-style schema sprawl:

* `Opportunity` stays stable
* Methodologies are versioned overlays
* Assessments are auditable and snapshot-bound
* Autonomy gates become enforceable policy
