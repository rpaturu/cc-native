# Review: Sales Methodology Schema & Assessment

## Overall Assessment

**Status:** ✅ **Strong foundation with targeted improvements needed**

Both documents are well-structured and align with core architectural principles. The methodology-as-overlay approach correctly keeps `Opportunity` methodology-agnostic. Several integration points and consistency improvements are needed.

---

## Strengths

### 1. Architecture Alignment ✅
- **Methodology-agnostic Opportunity**: Correctly avoids polluting core entities
- **Version pinning**: Methodology version binding prevents drift
- **Schema Registry integration**: Correctly identifies methodology as schema-registry entity
- **Snapshot binding**: Assessment binding to snapshots is explicit

### 2. World Model Principles ✅
- **Evidence-backed**: Dimension values require explicit provenance
- **Confidence gating**: Dimension-level confidence tracking
- **Freshness/TTL**: Per-dimension TTL enforcement
- **Deterministic computation**: Completeness and quality scores are computed deterministically

### 3. Autonomy Gating ✅
- **Tier cap (not override)**: Correctly states methodology gates can only tighten, not loosen
- **Alignment with AGENT_READ_POLICY**: References Tier A/B/C/D correctly

---

## Critical Issues to Address

### 1. Entity Type Registration

**Issue:** `SalesMethodology` and `MethodologyAssessment` are not in `EntityType` enum or `WORLD_STATE_SCHEMA_V1.md`.

**Required Actions:**
1. Add to `src/types/WorldStateTypes.ts`:
   ```typescript
   | 'SalesMethodology'
   | 'MethodologyAssessment'
   ```
2. Add schema definitions to `WORLD_STATE_SCHEMA_V1.md` (Tier B or C)
3. Ensure both entities follow `FieldState` pattern (confidence, freshness, contradiction, provenance)

**Impact:** Without entity type registration, agents cannot read these entities (Tier D).

---

### 2. Schema Registry Integration Details

**Issue:** Section 8 mentions Schema Registry but lacks implementation specifics.

**Required Additions:**
- **Storage path**: `s3://cc-native-schema-registry/{version}/SalesMethodology.json`
- **Hash computation**: Methodology JSON must be hashed (SHA-256)
- **Version resolution**: How agents resolve `methodology_version` → schema hash
- **Fail-closed rule**: Missing methodology version = Tier D (explicitly state)

**Recommendation:** Add subsection:
```markdown
### 8.1 Schema Registry Storage
- S3 path: `s3://cc-native-schema-registry/{version}/SalesMethodology-{methodology_id}.json`
- DynamoDB index: `cc-native-schema-registry` table
- Hash verification: Required on read (fail-closed)
- Version resolution: `methodology_id` + `version` → schema hash lookup
```

---

### 3. Dimension Field Type Alignment

**Issue:** `field_type` values don't map to World Model `FieldState` patterns.

**Current:** `boolean`, `enum`, `string`, `number`, `entity_ref`, `list_entity_ref`, `object`

**Required:** Each dimension value must be stored as `FieldState` with:
- `value` (typed per field_type)
- `confidence` (dimension-level)
- `freshness` (from `dimension_as_of`)
- `contradiction` (if multiple evidence sources)
- `provenanceTrust` (from `dimension_provenance`)
- `lastUpdated` (from `dimension_as_of`)
- `evidenceRefs` (from `dimension_provenance`)

**Recommendation:** Add explicit mapping:
```markdown
### 4.3 Dimension Value Storage
Each dimension value in `MethodologyAssessment.dimensions` maps to a `FieldState`:
- `dimensions[dimension_key].value` → `FieldState.value`
- `dimension_confidence[dimension_key]` → `FieldState.confidence`
- `dimension_as_of[dimension_key]` → `FieldState.lastUpdated` (compute freshness)
- `dimension_provenance[dimension_key]` → `FieldState.evidenceRefs` + `FieldState.provenanceTrust`
```

---

### 4. Autonomy Gate Enforcement

**Issue:** Section 6 states gates "may only tighten" but doesn't specify enforcement mechanism.

**Required:**
- **Policy precedence**: Global `AGENT_READ_POLICY.md` thresholds are minimums
- **Methodology gates**: Applied as `MIN(global_tier_threshold, methodology_tier_threshold)`
- **Computed tier**: `recommended_autonomy_tier_cap` is a **cap**, not override
- **Final tier**: Agent tier = `MIN(global_tier, methodology_tier_cap)`

**Recommendation:** Add explicit enforcement rule:
```markdown
### 6.1 Tier Cap Enforcement
Methodology `recommended_autonomy_tier_cap` is applied as:
```
final_tier = MIN(
  global_agent_read_policy_tier,
  methodology_recommended_tier_cap
)
```

If methodology cap is Tier C and global policy allows Tier A, agent gets Tier C.
If methodology cap is Tier A and global policy allows Tier C, agent gets Tier C (global minimum).
```

---

### 5. Evidence Reference Format

**Issue:** `dimension_provenance` stores strings like `["crm:contact_role"]` but doesn't specify format.

**Required:** Align with `EvidenceRef` from `CommonTypes.ts`:
```typescript
interface EvidenceRef {
  type: 's3' | 'crm' | 'transcript' | 'external';
  location: string;  // S3 key, CRM ID, etc.
  timestamp?: string;
}
```

**Recommendation:** Update example:
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

### 6. Computed Output Determinism

**Issue:** Section 5.1 states "deterministic" but doesn't specify computation algorithm.

**Required:**
- **Completeness formula**: `completed_dimensions / required_dimensions`
- **Quality score formula**: `SUM(dimension_weight * dimension_score) / SUM(dimension_weight)` where `dimension_score = confidence * freshness_multiplier * provenance_multiplier`
- **Freshness multiplier**: `1.0` if within TTL, `0.5` if 1x TTL, `0.25` if 2x TTL, etc.
- **Provenance multiplier**: `1.0` for PRIMARY/VERIFIED, `0.85` for DERIVED, `0.60` for AGENT_INFERENCE

**Recommendation:** Add computation spec:
```markdown
### 5.3 Completeness Computation
```
completeness = COUNT(dimensions where:
  value != null AND
  confidence >= min_confidence_autonomous AND
  freshness <= ttl_days AND
  provenance in allowed_provenance
) / COUNT(required_dimensions)
```

### 5.4 Quality Score Computation
```
quality_score = SUM(
  dimension.weight * (
    dimension.confidence *
    freshness_multiplier(dimension.freshness, dimension.ttl_days) *
    provenance_multiplier(dimension.provenance_trust)
  )
) / SUM(dimension.weight for all dimensions)
```
```

---

## Medium-Priority Improvements

### 7. Tenant Customization Versioning

**Issue:** Section 7 mentions "new version" but doesn't specify version format.

**Recommendation:** Use semantic versioning or date-based:
- `{methodology_id}-{tenant_id}-{YYYY-MM-DD}-v{N}` for tenant customizations
- `{methodology_id}-global-{YYYY-MM-DD}-v{N}` for global versions

---

### 8. Assessment Supersession Tracking

**Issue:** Section 8 mentions `SUPERSEDED` status but doesn't specify how to query active vs. historical.

**Recommendation:** Add GSI pattern:
- Main table: `pk = ASSESSMENT#{assessment_id}`, `sk = VERSION#{timestamp}`
- GSI1: `pk = OPPORTUNITY#{opportunity_id}`, `sk = METHODOLOGY#{methodology_id}#{status}#{timestamp}`
- Query active: `status = ACTIVE`, most recent first

---

### 9. Missing API Contract Details

**Issue:** Section 10 lists minimal APIs but doesn't specify:
- Error handling (missing methodology version, invalid dimension keys)
- Validation rules (dimension values must match `field_type`)
- Batch operations (create assessments for multiple opportunities)

**Recommendation:** Expand to:
```markdown
### 10.1 CreateAssessment
- **Input**: `opportunity_id`, `methodology_id`, `methodology_version`
- **Validation**: 
  - Methodology version must exist in Schema Registry
  - Opportunity must exist
  - Methodology must be ACTIVE
- **Output**: `MethodologyAssessment` with `status = DRAFT`
- **Errors**: `METHODOLOGY_NOT_FOUND`, `INVALID_VERSION`, `OPPORTUNITY_NOT_FOUND`

### 10.2 GetActiveAssessment
- **Input**: `opportunity_id`, `methodology_id`
- **Query**: GSI1 where `status = ACTIVE`, most recent
- **Output**: `MethodologyAssessment | null`
```

---

## Integration Checklist

Before implementation, ensure:

- [ ] `SalesMethodology` added to `EntityType` enum
- [ ] `MethodologyAssessment` added to `EntityType` enum
- [ ] Both entities added to `WORLD_STATE_SCHEMA_V1.md`
- [ ] Schema Registry storage paths defined
- [ ] Hash verification rules specified
- [ ] Dimension value → `FieldState` mapping documented
- [ ] Autonomy tier cap enforcement algorithm specified
- [ ] Evidence reference format aligned with `EvidenceRef`
- [ ] Completeness/quality score computation formulas documented
- [ ] API error handling specified
- [ ] GSI patterns for assessment queries defined

---

## Summary

**Core Design:** ✅ Excellent - methodology-as-overlay is architecturally sound

**Integration:** ⚠️ Needs work - entity registration, schema registry details, field state mapping

**Completeness:** ⚠️ Needs work - computation formulas, error handling, query patterns

**Recommendation:** Address critical issues (1-6) before implementation. Medium-priority items (7-9) can be refined during implementation.
