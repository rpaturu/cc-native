import * as fs from 'fs';
import * as path from 'path';
import { TrustClass } from '../../../types/CommonTypes';

// TODO: Import these types when MethodologyTypes and AssessmentTypes are implemented
// import { SalesMethodology } from '../../../types/MethodologyTypes';
// import { MethodologyAssessment } from '../../../types/AssessmentTypes';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/methodology');

describe('Methodology Fixtures Validation', () => {
  describe('MEDDICC Baseline', () => {
    let methodology: any; // TODO: Use SalesMethodology type when implemented

    beforeAll(() => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'meddicc-baseline.json'),
        'utf-8'
      );
      methodology = JSON.parse(content);
    });

    it('should have valid structure', () => {
      expect(methodology.methodology_id).toBe('meth:meddicc');
      expect(methodology.name).toBe('MEDDICC');
      expect(methodology.version).toBeDefined();
      expect(methodology.status).toBe('ACTIVE');
      expect(methodology.dimensions).toBeInstanceOf(Array);
      expect(methodology.scoring_model).toBeDefined();
      expect(methodology.autonomy_gates).toBeDefined();
    });

    it('should have all required fields', () => {
      expect(methodology.methodology_id).toBeDefined();
      expect(methodology.name).toBeDefined();
      expect(methodology.version).toBeDefined();
      expect(methodology.tenant_id).toBeDefined();
      expect(methodology.status).toBeDefined();
      expect(methodology.dimensions).toBeDefined();
      expect(methodology.scoring_model).toBeDefined();
      expect(methodology.autonomy_gates).toBeDefined();
      expect(methodology.created_at).toBeDefined();
      expect(methodology.updated_at).toBeDefined();
    });

    it('should have valid dimension structure', () => {
      for (const dimension of methodology.dimensions) {
        expect(dimension.dimension_key).toBeDefined();
        expect(dimension.label).toBeDefined();
        expect(dimension.critical).toBeDefined();
        expect(dimension.required).toBeDefined();
        expect(dimension.field_type).toBeDefined();
        expect(dimension.min_confidence_autonomous).toBeGreaterThanOrEqual(0);
        expect(dimension.min_confidence_autonomous).toBeLessThanOrEqual(1);
        expect(dimension.ttl_days).toBeGreaterThan(0);
        expect(dimension.allowed_provenance).toBeInstanceOf(Array);
        expect(dimension.completion_rule).toBeDefined();
        expect(dimension.score_rule).toBeDefined();
      }
    });

    it('should use valid TrustClass values', () => {
      const validTrustClasses: TrustClass[] = [
        'PRIMARY',
        'VERIFIED',
        'DERIVED',
        'AGENT_INFERENCE',
        'UNTRUSTED',
      ];

      for (const dimension of methodology.dimensions) {
        for (const provenance of dimension.allowed_provenance) {
          expect(validTrustClasses).toContain(provenance);
        }
      }
    });

    it('should have valid scoring model', () => {
      expect(methodology.scoring_model.completeness_formula).toBeDefined();
      expect(methodology.scoring_model.quality_formula).toBeDefined();
      expect(methodology.scoring_model.freshness_decay).toBeDefined();
      expect(methodology.scoring_model.provenance_multipliers).toBeDefined();

      // Verify provenance multipliers
      const validTrustClasses: TrustClass[] = [
        'PRIMARY',
        'VERIFIED',
        'DERIVED',
        'AGENT_INFERENCE',
        'UNTRUSTED',
      ];

      for (const trustClass of validTrustClasses) {
        expect(methodology.scoring_model.provenance_multipliers[trustClass]).toBeDefined();
        expect(methodology.scoring_model.provenance_multipliers[trustClass]).toBeGreaterThanOrEqual(0);
        expect(methodology.scoring_model.provenance_multipliers[trustClass]).toBeLessThanOrEqual(1);
      }
    });

    it('should have valid autonomy gates', () => {
      expect(methodology.autonomy_gates.tier_a).toBeDefined();
      expect(methodology.autonomy_gates.tier_b).toBeDefined();
      expect(methodology.autonomy_gates.tier_c).toBeDefined();

      if (methodology.autonomy_gates.tier_a?.min_completeness) {
        expect(methodology.autonomy_gates.tier_a.min_completeness).toBeGreaterThanOrEqual(0);
        expect(methodology.autonomy_gates.tier_a.min_completeness).toBeLessThanOrEqual(1);
      }

      if (methodology.autonomy_gates.tier_a?.min_quality_score) {
        expect(methodology.autonomy_gates.tier_a.min_quality_score).toBeGreaterThanOrEqual(0);
        expect(methodology.autonomy_gates.tier_a.min_quality_score).toBeLessThanOrEqual(1);
      }
    });

    it('should have normalized dimension weights', () => {
      const totalWeight = methodology.dimensions.reduce(
        (sum: number, dim: any) => sum + (dim.score_rule.weight || 0),
        0
      );

      // Weights should sum to approximately 1.0 (allow small rounding differences)
      expect(totalWeight).toBeGreaterThan(0.95);
      expect(totalWeight).toBeLessThan(1.05);
    });
  });

  describe('Assessment Fixtures', () => {
    it('should validate complete assessment', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'assessment-complete.json'),
        'utf-8'
      );
      const assessment: any = JSON.parse(content); // TODO: Use MethodologyAssessment type when implemented

      expect(assessment.assessment_id).toBeDefined();
      expect(assessment.opportunity_id).toBeDefined();
      expect(assessment.methodology_id).toBeDefined();
      expect(assessment.methodology_version).toBeDefined();
      expect(assessment.status).toBe('ACTIVE');
      expect(assessment.dimensions).toBeDefined();
      expect(assessment.computed).toBeDefined();

      // Verify computed outputs
      expect(assessment.computed.completeness).toBeGreaterThanOrEqual(0);
      expect(assessment.computed.completeness).toBeLessThanOrEqual(1);
      expect(assessment.computed.quality_score).toBeGreaterThanOrEqual(0);
      expect(assessment.computed.quality_score).toBeLessThanOrEqual(1);
      expect(assessment.computed.recommended_autonomy_tier_cap).toMatch(/^TIER_[ABCD]$/);
    });

    it('should validate incomplete assessment', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'assessment-incomplete.json'),
        'utf-8'
      );
      const assessment: any = JSON.parse(content); // TODO: Use MethodologyAssessment type when implemented

      expect(assessment.computed.completeness).toBeLessThan(1.0);
      expect(assessment.computed.critical_dimensions_complete).toBe(false);
      expect(assessment.computed.reasons.length).toBeGreaterThan(0);
    });

    it('should validate stale assessment', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'assessment-stale.json'),
        'utf-8'
      );
      const assessment: any = JSON.parse(content); // TODO: Use MethodologyAssessment type when implemented

      expect(assessment.computed.fails_due_to_freshness).toBe(true);
      expect(assessment.computed.reasons.some((r: string) => r.includes('STALE'))).toBe(true);
    });

    it('should validate inference-only assessment', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'assessment-inference-only.json'),
        'utf-8'
      );
      const assessment: any = JSON.parse(content); // TODO: Use MethodologyAssessment type when implemented

      expect(assessment.computed.fails_due_to_provenance).toBe(true);
      expect(assessment.computed.recommended_autonomy_tier_cap).toBe('TIER_C');
      expect(assessment.computed.reasons.some((r: string) => r.includes('INFERENCE_ONLY'))).toBe(true);
    });
  });

  describe('Dimension Value Structure', () => {
    it('should validate dimension values match FieldState pattern', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'assessment-complete.json'),
        'utf-8'
      );
      const assessment: any = JSON.parse(content); // TODO: Use MethodologyAssessment type when implemented

      for (const [dimensionKey, dimensionValue] of Object.entries(assessment.dimensions)) {
        const dim = dimensionValue as any; // Type assertion for test
        expect(dim.value).toBeDefined();
        expect(dim.confidence).toBeGreaterThanOrEqual(0);
        expect(dim.confidence).toBeLessThanOrEqual(1);
        expect(dim.freshness).toBeGreaterThanOrEqual(0);
        expect(dim.contradiction).toBeGreaterThanOrEqual(0);
        expect(dim.contradiction).toBeLessThanOrEqual(1);
        expect(['PRIMARY', 'VERIFIED', 'DERIVED', 'AGENT_INFERENCE', 'UNTRUSTED']).toContain(
          dim.provenanceTrust
        );
        expect(dim.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(dim.evidenceRefs).toBeInstanceOf(Array);
      }
    });
  });
});
