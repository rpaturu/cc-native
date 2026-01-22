import { AssessmentComputationService } from '../../../services/methodology/AssessmentComputationService';
import { Logger } from '../../../services/core/Logger';
import { MethodologyAssessment, DimensionValue } from '../../../types/AssessmentTypes';
import { SalesMethodology } from '../../../types/MethodologyTypes';
import * as fs from 'fs';
import * as path from 'path';

describe('AssessmentComputationService', () => {
  let service: AssessmentComputationService;
  let logger: Logger;
  let meddiccMethodology: SalesMethodology;

  beforeEach(() => {
    logger = new Logger('Test');
    service = new AssessmentComputationService(logger);
    
    // Load MEDDICC methodology fixture
    const fixturePath = path.join(__dirname, '../../fixtures/methodology/meddicc-baseline.json');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf-8');
    const fixture = JSON.parse(fixtureContent);
    
    // Convert fixture to SalesMethodology (fix tenant_id -> tenantId)
    meddiccMethodology = {
      ...fixture,
      tenantId: fixture.tenant_id,
    } as SalesMethodology;
  });

  describe('computeCompleteness', () => {
    it('should return 1.0 when no required dimensions', () => {
      const methodology: SalesMethodology = {
        ...meddiccMethodology,
        dimensions: meddiccMethodology.dimensions.map(d => ({ ...d, required: false })),
      };
      
      const completeness = service.computeCompleteness({}, methodology);
      expect(completeness).toBe(1.0);
    });

    it('should return 0.0 when no dimensions provided', () => {
      const requiredDimensions = meddiccMethodology.dimensions.filter(d => d.required);
      expect(requiredDimensions.length).toBeGreaterThan(0);
      
      const completeness = service.computeCompleteness({}, meddiccMethodology);
      expect(completeness).toBe(0.0);
    });

    it('should compute completeness correctly for partial completion', () => {
      const dimensions: Record<string, DimensionValue> = {
        metrics: {
          value: { defined: true },
          confidence: 0.90,
          freshness: 10,
          contradiction: 0,
          provenanceTrust: 'PRIMARY',
          lastUpdated: new Date().toISOString(),
          evidenceRefs: [],
        },
        economic_buyer: {
          value: { contact_id: 'contact:123' },
          confidence: 0.95,
          freshness: 5,
          contradiction: 0,
          provenanceTrust: 'PRIMARY',
          lastUpdated: new Date().toISOString(),
          evidenceRefs: [],
        },
      };

      const completeness = service.computeCompleteness(dimensions, meddiccMethodology);
      // Count required dimensions in methodology
      const requiredCount = meddiccMethodology.dimensions.filter(d => d.required).length;
      // 2 complete out of requiredCount
      expect(completeness).toBeCloseTo(2 / requiredCount, 2);
    });

    it('should exclude incomplete dimensions from count', () => {
      const dimensions: Record<string, DimensionValue> = {
        metrics: {
          value: { defined: true },
          confidence: 0.50, // Below min_confidence_autonomous (0.75)
          freshness: 10,
          contradiction: 0,
          provenanceTrust: 'PRIMARY',
          lastUpdated: new Date().toISOString(),
          evidenceRefs: [],
        },
      };

      const completeness = service.computeCompleteness(dimensions, meddiccMethodology);
      expect(completeness).toBe(0.0);
    });
  });

  describe('computeQualityScore', () => {
    it('should return 0.0 when no dimensions provided', () => {
      const qualityScore = service.computeQualityScore({}, meddiccMethodology);
      expect(qualityScore).toBe(0.0);
    });

    it('should compute quality score with freshness and provenance multipliers', () => {
      const dimensions: Record<string, DimensionValue> = {
        metrics: {
          value: { defined: true },
          confidence: 0.90,
          freshness: 10, // Within TTL (45 days = 1080 hours)
          contradiction: 0,
          provenanceTrust: 'PRIMARY',
          lastUpdated: new Date().toISOString(),
          evidenceRefs: [],
        },
      };

      const qualityScore = service.computeQualityScore(dimensions, meddiccMethodology);
      
      // Expected: (weight * confidence * freshness_multiplier * provenance_multiplier) / totalWeight
      // weight = 0.15, confidence = 0.90, freshness = 1.0 (within_ttl), provenance = 1.0 (PRIMARY)
      // score = 0.15 * 0.90 * 1.0 * 1.0 / 0.15 = 0.90
      expect(qualityScore).toBeCloseTo(0.90, 2);
    });

    it('should exclude stale dimensions from quality score', () => {
      const dimensions: Record<string, DimensionValue> = {
        metrics: {
          value: { defined: true },
          confidence: 0.90,
          freshness: 50 * 24, // 50 days = beyond TTL (45 days = 1080 hours)
          contradiction: 0,
          provenanceTrust: 'PRIMARY',
          lastUpdated: new Date().toISOString(),
          evidenceRefs: [],
        },
      };

      const qualityScore = service.computeQualityScore(dimensions, meddiccMethodology);
      
      // Stale dimensions are excluded (isDimensionComplete returns false)
      // So quality score should be 0
      expect(qualityScore).toBe(0.0);
    });

    it('should apply provenance multipliers correctly', () => {
      // Use DERIVED provenance (allowed for metrics, multiplier = 0.85)
      const dimensions: Record<string, DimensionValue> = {
        metrics: {
          value: { defined: true },
          confidence: 0.90,
          freshness: 10,
          contradiction: 0,
          provenanceTrust: 'DERIVED', // Multiplier = 0.85 (from methodology)
          lastUpdated: new Date().toISOString(),
          evidenceRefs: [],
        },
      };

      const qualityScore = service.computeQualityScore(dimensions, meddiccMethodology);
      
      // score = 0.15 * 0.90 * 1.0 * 0.85 / 0.15 = 0.765
      expect(qualityScore).toBeCloseTo(0.765, 2);
    });
  });

  describe('computeAutonomyTierCap', () => {
    it('should return TIER_A when all gates met', () => {
      const computed = {
        completeness: 0.85,
        quality_score: 0.80,
        critical_dimensions_complete: true,
        fails_due_to_freshness: false,
        fails_due_to_provenance: false,
        recommended_autonomy_tier_cap: 'TIER_A' as const,
        reasons: [],
      };

      const tier = service.computeAutonomyTierCap(computed, meddiccMethodology);
      expect(tier).toBe('TIER_A');
    });

    it('should return TIER_B when Tier A gates not met but Tier B met', () => {
      const computed = {
        completeness: 0.60,
        quality_score: 0.70,
        critical_dimensions_complete: false,
        fails_due_to_freshness: false,
        fails_due_to_provenance: false,
        recommended_autonomy_tier_cap: 'TIER_B' as const,
        reasons: [],
      };

      const tier = service.computeAutonomyTierCap(computed, meddiccMethodology);
      expect(tier).toBe('TIER_B');
    });

    it('should return TIER_D when no gates met', () => {
      const computed = {
        completeness: 0.10,
        quality_score: 0.20,
        critical_dimensions_complete: false,
        fails_due_to_freshness: true,
        fails_due_to_provenance: true,
        recommended_autonomy_tier_cap: 'TIER_D' as const,
        reasons: [],
      };

      const tier = service.computeAutonomyTierCap(computed, meddiccMethodology);
      expect(tier).toBe('TIER_D');
    });
  });

  describe('computeAssessment', () => {
    it('should compute all metrics correctly', async () => {
      const assessment: MethodologyAssessment = {
        assessment_id: 'test-123',
        tenantId: 'tenant:test',
        opportunity_id: 'opportunity:test',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'ACTIVE',
        dimensions: {
          metrics: {
            value: { defined: true },
            confidence: 0.90,
            freshness: 10,
            contradiction: 0,
            provenanceTrust: 'PRIMARY',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [],
          },
        },
        computed: {
          completeness: 0,
          quality_score: 0,
          critical_dimensions_complete: false,
          fails_due_to_freshness: false,
          fails_due_to_provenance: false,
          recommended_autonomy_tier_cap: 'TIER_D',
          reasons: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const computed = await service.computeAssessment(assessment, meddiccMethodology);

      expect(computed.completeness).toBeGreaterThan(0);
      expect(computed.quality_score).toBeGreaterThan(0);
      expect(computed.recommended_autonomy_tier_cap).toBeDefined();
      expect(computed.reasons.length).toBeGreaterThan(0);
    });
  });
});
