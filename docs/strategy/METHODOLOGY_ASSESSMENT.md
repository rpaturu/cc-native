# METHODOLOGY_ASSESSMENT

## 1. Purpose

This document defines `MethodologyAssessment`, the entity that represents applying a specific **Sales Methodology** (MEDDICC, SPIN, Challenger, custom) to a specific **Opportunity**.

It exists to:

* Keep `Opportunity` methodology-agnostic
* Encode methodology-specific evaluation in a structured, auditable way
* Support confidence/TTL/provenance gating
* Bind assessments into `WORLD_SNAPSHOT_CONTRACT.md`

**Entity Type:** `MethodologyAssessment` (registered in `WORLD_STATE_SCHEMA_V1.md`)

---

## 2. Core Principle

> **A methodology assessment is a point-in-time, evidence-backed evaluation of an opportunity.**

It is not a free-form note. It is a structured object with:

* explicit dimension values
* explicit confidence
* explicit provenance
* explicit freshness

---

## 3. Entity: MethodologyAssessment

### 3.1 Required Fields

| Field                  | Type   | Critical | Required | Notes                              |
| ---------------------- | ------ | -------: | -------: | ---------------------------------- |
| `assessment_id`        | string |        ✅ |        ✅ | Stable identifier                  |
| `tenant_id`            | string |        ✅ |        ✅ | Tenant boundary                    |
| `opportunity_id`       | string |        ✅ |        ✅ | FK to Opportunity                  |
| `methodology_id`       | string |        ✅ |        ✅ | FK to SalesMethodology             |
| `methodology_version`  | string |        ✅ |        ✅ | Version pin (no drifting)          |
| `created_at`           | date   |        ✅ |        ✅ | Audit                              |
| `updated_at`           | date   |        ✅ |        ✅ | Audit                              |
| `status`               | enum   |        ✅ |        ✅ | ACTIVE/SUPERSEDED/DRAFT            |
| `dimensions`           | object |        ✅ |        ✅ | Values per dimension_key           |
| `dimension_confidence` | object |        ✅ |        ✅ | Confidence per dimension_key       |
| `dimension_provenance` | object |        ✅ |        ✅ | Evidence refs per dimension_key    |
| `dimension_as_of`      | object |        ✅ |        ✅ | As-of timestamps per dimension_key |
| `computed`             | object |        ✅ |        ✅ | Deterministic derived outputs      |

---

## 4. Dimension Storage Format

### 4.1 Dimensions Map

`dimensions` is a map keyed by `dimension_key`.

### 4.2 FieldState Mapping

Each dimension value maps to World Model `FieldState` pattern:

* `dimensions[dimension_key].value` → `FieldState.value` (typed per `field_type`)
* `dimension_confidence[dimension_key]` → `FieldState.confidence` ([0, 1])
* `dimension_as_of[dimension_key]` → `FieldState.lastUpdated` (ISO 8601, compute freshness in hours)
* `dimension_provenance[dimension_key]` → `FieldState.evidenceRefs` (array of `EvidenceRef`)
* `dimension_provenance[dimension_key]` → `FieldState.provenanceTrust` (highest trust class from evidence)

**Freshness Computation:**
```
freshness_hours = (now - dimension_as_of[dimension_key]) / (1000 * 60 * 60)
```

**Contradiction Computation:**
If multiple evidence sources for same dimension with conflicting values:
```
contradiction = COUNT(conflicting_values) / COUNT(total_values)
```

Example:

```json
{
  "dimensions": {
    "economic_buyer": {"contact_id": "contact:123"},
    "decision_process": {"known": true},
    "metrics": {"defined": false}
  },
  "dimension_confidence": {
    "economic_buyer": 0.88,
    "decision_process": 0.72,
    "metrics": 0.55
  },
  "dimension_provenance": {
    "economic_buyer": [
      {"type": "crm", "location": "contact_role:123", "timestamp": "2026-01-10T00:00:00Z"}
    ],
    "decision_process": [
      {"type": "transcript", "location": "s3://.../transcript-2026-01-15.json", "timestamp": "2026-01-15T00:00:00Z"}
    ],
    "metrics": [
      {"type": "external", "location": "agent_inference:meeting_prep_v1", "timestamp": "2026-01-18T00:00:00Z"}
    ]
  },
  "dimension_as_of": {
    "economic_buyer": "2026-01-10T00:00:00Z",
    "decision_process": "2026-01-15T00:00:00Z",
    "metrics": "2026-01-18T00:00:00Z"
  }
}
```

---

## 5. Computed Outputs (Deterministic)

`computed` is produced deterministically from:

* `dimensions`
* confidence
* provenance constraints
* TTL freshness
* methodology scoring model

### 5.1 Required Computed Fields

| Field                           | Type    | Notes                            |
| ------------------------------- | ------- | -------------------------------- |
| `completeness`                  | number  | 0–1                              |
| `quality_score`                 | number  | 0–1                              |
| `critical_dimensions_complete`  | boolean | Required critical dims satisfied |
| `fails_due_to_freshness`        | boolean | Any required dims stale          |
| `fails_due_to_provenance`       | boolean | Inference-only for critical dims |
| `recommended_autonomy_tier_cap` | enum    | A/B/C/D (cap, not override)      |
| `reasons`                       | list    | Deterministic reason codes       |

### 5.2 Completeness Computation

```
completeness = COUNT(dimensions where:
  value != null AND
  confidence >= min_confidence_autonomous AND
  freshness <= ttl_days AND
  provenance in allowed_provenance
) / COUNT(required_dimensions)
```

### 5.3 Quality Score Computation

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
* `freshness_multiplier(freshness_hours, ttl_days)`: 
  * `1.0` if `freshness_hours <= ttl_days * 24`
  * `0.5` if `freshness_hours <= ttl_days * 48`
  * `0.25` if `freshness_hours <= ttl_days * 72`
  * `0.1` if `freshness_hours > ttl_days * 72`
* `provenance_multiplier(trust_class)`:
  * `1.0` for PRIMARY, VERIFIED
  * `0.85` for DERIVED
  * `0.60` for AGENT_INFERENCE
  * `0.30` for UNTRUSTED

### 5.4 Autonomy Tier Cap Computation

```
recommended_autonomy_tier_cap = MIN(
  methodology.tier_a_threshold → Tier A,
  methodology.tier_b_threshold → Tier B,
  methodology.tier_c_threshold → Tier C,
  default → Tier D
)
```

Where tier thresholds are evaluated in order (A → B → C → D), and the first threshold that is NOT met determines the cap.

**Hard rule:**

* `recommended_autonomy_tier_cap` may only **tighten** autonomy, never loosen it.
* Final agent tier = `MIN(global_agent_read_policy_tier, recommended_autonomy_tier_cap)`

Example:

```json
{
  "computed": {
    "completeness": 0.64,
    "quality_score": 0.58,
    "critical_dimensions_complete": false,
    "fails_due_to_freshness": false,
    "fails_due_to_provenance": true,
    "recommended_autonomy_tier_cap": "C",
    "reasons": ["CRITICAL_DIM_INFERENCE_ONLY", "REQUIRED_DIM_INCOMPLETE"]
  }
}
```

---

## 6. Freshness & TTL Enforcement

For each dimension:

* compute freshness = `(now - dimension_as_of[dimension_key]) / (1000 * 60 * 60)` (hours)
* compare against methodology `ttl_days` (convert to hours: `ttl_days * 24`)

If stale:

* dimension treated as incomplete
* reason code emitted: `DIMENSION_STALE_{dimension_key}`

---

## 7. Provenance Enforcement

For each dimension:

* validate provenance sources are in `allowed_provenance` (from methodology definition)
* if not in allowed list → dimension incomplete, reason: `PROVENANCE_NOT_ALLOWED_{dimension_key}`

For critical dimensions:

* if all provenance is inference-only (AGENT_INFERENCE) ⇒ dimension incomplete
* set `fails_due_to_provenance = true`
* reason code: `CRITICAL_DIM_INFERENCE_ONLY_{dimension_key}`

---

## 8. Supersession Model

Assessments may be regenerated.

Rules:

* New assessment supersedes old via:

  * old `status = SUPERSEDED`
  * new `status = ACTIVE`
* Historical snapshots bind to the assessment version they used

**Query Pattern:**
* Main table: `pk = ASSESSMENT#{assessment_id}`, `sk = VERSION#{timestamp}`
* GSI1: `pk = OPPORTUNITY#{opportunity_id}`, `sk = METHODOLOGY#{methodology_id}#{status}#{timestamp}`
* Query active: Filter `status = ACTIVE`, sort by `timestamp DESC`, limit 1

---

## 9. Snapshot Binding

World snapshots MUST include:

* the `assessment_id`
* the methodology version
* computed outputs (completeness, score, tier cap)

This makes decisions replayable and defensible.

**Snapshot Metadata:**
```json
{
  "snapshotId": "snap_...",
  "metadata": {
    "assessmentId": "assessment:123",
    "methodologyId": "meddicc",
    "methodologyVersion": "2026-01-v1",
    "computed": {
      "completeness": 0.64,
      "quality_score": 0.58,
      "recommended_autonomy_tier_cap": "C"
    }
  }
}
```

---

## 10. API Contract

### 10.1 CreateAssessment

**Input:**
```typescript
{
  opportunity_id: string;
  methodology_id: string;
  methodology_version: string;
}
```

**Validation:**
* Methodology version must exist in Schema Registry (fail-closed: Tier D if missing)
* Opportunity must exist
* Methodology must be ACTIVE

**Output:** `MethodologyAssessment` with `status = DRAFT`

**Errors:**
* `METHODOLOGY_NOT_FOUND` - Methodology ID not found
* `INVALID_VERSION` - Version not found in Schema Registry
* `OPPORTUNITY_NOT_FOUND` - Opportunity entity not found
* `METHODOLOGY_DEPRECATED` - Methodology status is DEPRECATED

### 10.2 GetAssessment

**Input:**
```typescript
{
  assessment_id: string;
}
```

**Output:** `MethodologyAssessment | null`

**Errors:**
* `ASSESSMENT_NOT_FOUND` - Assessment ID not found

### 10.3 GetActiveAssessment

**Input:**
```typescript
{
  opportunity_id: string;
  methodology_id: string;
}
```

**Query:** GSI1 where `status = ACTIVE`, most recent first, limit 1

**Output:** `MethodologyAssessment | null`

### 10.4 UpdateAssessment

**Input:**
```typescript
{
  assessment_id: string;
  dimensions?: Record<string, any>;
  dimension_confidence?: Record<string, number>;
  dimension_provenance?: Record<string, EvidenceRef[]>;
  dimension_as_of?: Record<string, string>;
}
```

**Validation:**
* Dimension keys must exist in methodology definition
* Dimension values must match `field_type` from methodology
* Confidence must be [0, 1]
* Provenance must be in `allowed_provenance` for dimension

**Output:** Updated `MethodologyAssessment` with recomputed `computed` fields

**Errors:**
* `INVALID_DIMENSION_KEY` - Dimension key not in methodology
* `INVALID_DIMENSION_VALUE` - Value doesn't match field_type
* `INVALID_PROVENANCE` - Provenance not in allowed list

---

## 11. Summary

`MethodologyAssessment` enables methodology choice without CRM schema sprawl:

* Opportunity remains stable
* Methodology versions are pinned
* Evidence, confidence, freshness are explicit
* Autonomy gating is enforceable and auditable
* Computed outputs are deterministic and replayable
