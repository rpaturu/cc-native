import { Logger } from '../core/Logger';
import { 
  IAssessmentComputationService, 
  MethodologyAssessment, 
  AssessmentComputed, 
  DimensionValue 
} from '../../types/AssessmentTypes';
import { SalesMethodology, MethodologyDimension } from '../../types/MethodologyTypes';
import { AutonomyTier } from '../../types/CommonTypes';

/**
 * AssessmentComputationService - Deterministic computation of assessment metrics
 * 
 * All computations are deterministic and reproducible.
 * Uses methodology configuration (freshness_decay, provenance_multipliers) for scoring.
 */
export class AssessmentComputationService implements IAssessmentComputationService {
  private logger: Logger;

  // NOTE: Provenance multipliers are now sourced from methodology.scoring_model.provenance_multipliers
  // This allows tenant-specific customization and methodology-specific trust models.
  // No hardcoded constants - all multipliers come from methodology configuration.

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Compute all assessment metrics
   */
  async computeAssessment(
    assessment: MethodologyAssessment,
    methodology: SalesMethodology
  ): Promise<AssessmentComputed> {
    const completeness = this.computeCompleteness(assessment.dimensions, methodology);
    const qualityScore = this.computeQualityScore(assessment.dimensions, methodology);
    
    const criticalDimensionsComplete = this.checkCriticalDimensions(
      assessment.dimensions,
      methodology
    );
    
    const failsDueToFreshness = this.checkFreshnessFailures(
      assessment.dimensions,
      methodology
    );
    
    const failsDueToProvenance = this.checkProvenanceFailures(
      assessment.dimensions,
      methodology
    );
    
    const reasons = this.computeReasons(
      assessment.dimensions,
      methodology,
      criticalDimensionsComplete,
      failsDueToFreshness,
      failsDueToProvenance
    );
    
    const recommendedTierCap = this.computeAutonomyTierCap(
      { completeness, quality_score: qualityScore, critical_dimensions_complete: criticalDimensionsComplete },
      methodology
    );

    return {
      completeness,
      quality_score: qualityScore,
      critical_dimensions_complete: criticalDimensionsComplete,
      fails_due_to_freshness: failsDueToFreshness,
      fails_due_to_provenance: failsDueToProvenance,
      recommended_autonomy_tier_cap: recommendedTierCap,
      reasons,
    };
  }

  /**
   * Compute completeness (deterministic)
   */
  computeCompleteness(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): number {
    const requiredDimensions = methodology.dimensions.filter(d => d.required);
    
    if (requiredDimensions.length === 0) {
      return 1.0;  // No required dimensions = 100% complete
    }

    let completedCount = 0;

    for (const dimension of requiredDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (!dimensionValue) {
        continue;  // Missing dimension
      }

      // Check completion criteria
      const isComplete = this.isDimensionComplete(dimensionValue, dimension);
      
      if (isComplete) {
        completedCount++;
      }
    }

    return completedCount / requiredDimensions.length;
  }

  /**
   * Compute quality score (deterministic)
   */
  computeQualityScore(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const dimension of methodology.dimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (!dimensionValue) {
        continue;  // Missing dimension doesn't contribute
      }

      // Check if dimension is complete
      if (!this.isDimensionComplete(dimensionValue, dimension)) {
        continue;  // Incomplete dimension doesn't contribute
      }

      const weight = dimension.score_rule.weight || 1.0;
      const freshnessMultiplier = this.computeFreshnessMultiplier(
        dimensionValue.freshness,
        dimension.ttl_days,
        methodology.scoring_model.freshness_decay
      );
      const provenanceMultiplier = methodology.scoring_model.provenance_multipliers[dimensionValue.provenanceTrust] || 0;

      const dimensionScore = 
        dimensionValue.confidence * 
        freshnessMultiplier * 
        provenanceMultiplier;

      weightedSum += weight * dimensionScore;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Compute autonomy tier cap
   */
  computeAutonomyTierCap(
    computed: Partial<AssessmentComputed>,
    methodology: SalesMethodology
  ): AutonomyTier {
    const gates = methodology.autonomy_gates;

    // Check Tier A
    if (gates.tier_a) {
      const tierA = gates.tier_a;
      const meetsCompleteness = !tierA.min_completeness || 
        (computed.completeness !== undefined && computed.completeness >= tierA.min_completeness);
      const meetsQuality = !tierA.min_quality_score || 
        (computed.quality_score !== undefined && computed.quality_score >= tierA.min_quality_score);
      const meetsCritical = !tierA.required_critical_dimensions_complete || 
        computed.critical_dimensions_complete === true;

      if (meetsCompleteness && meetsQuality && meetsCritical) {
        return 'TIER_A';
      }
    }

    // Check Tier B
    if (gates.tier_b) {
      const tierB = gates.tier_b;
      const meetsCompleteness = !tierB.min_completeness || 
        (computed.completeness !== undefined && computed.completeness >= tierB.min_completeness);
      const meetsQuality = !tierB.min_quality_score || 
        (computed.quality_score !== undefined && computed.quality_score >= tierB.min_quality_score);

      if (meetsCompleteness && meetsQuality) {
        return 'TIER_B';
      }
    }

    // Check Tier C
    if (gates.tier_c) {
      const tierC = gates.tier_c;
      const meetsCompleteness = !tierC.min_completeness || 
        (computed.completeness !== undefined && computed.completeness >= tierC.min_completeness);

      if (meetsCompleteness) {
        return 'TIER_C';
      }
    }

    // Default to Tier D
    return 'TIER_D';
  }

  /**
   * Check if dimension is complete
   */
  private isDimensionComplete(
    dimensionValue: DimensionValue,
    dimension: MethodologyDimension
  ): boolean {
    // Check value is not null
    if (dimensionValue.value === null || dimensionValue.value === undefined) {
      return false;
    }

    // Check confidence threshold
    if (dimensionValue.confidence < dimension.min_confidence_autonomous) {
      return false;
    }

    // Check freshness (within TTL)
    const ttlHours = dimension.ttl_days * 24;
    if (dimensionValue.freshness > ttlHours) {
      return false;
    }

    // Check provenance is allowed
    if (!dimension.allowed_provenance.includes(dimensionValue.provenanceTrust)) {
      return false;
    }

    return true;
  }

  /**
   * Compute freshness multiplier using methodology's freshness_decay configuration
   * 
   * Uses the methodology's scoring_model.freshness_decay values, not hardcoded defaults.
   */
  private computeFreshnessMultiplier(
    freshnessHours: number,
    ttlDays: number,
    freshnessDecay: SalesMethodology['scoring_model']['freshness_decay']
  ): number {
    const ttlHours = ttlDays * 24;
    
    // Use methodology's freshness_decay configuration
    const model = freshnessDecay;

    if (freshnessHours <= ttlHours) {
      return model.within_ttl;
    } else if (freshnessHours <= ttlHours * 2) {
      return model.one_x_ttl;
    } else if (freshnessHours <= ttlHours * 3) {
      return model.two_x_ttl;
    } else {
      return model.beyond_two_x_ttl;
    }
  }

  /**
   * Check critical dimensions complete
   */
  private checkCriticalDimensions(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): boolean {
    const criticalDimensions = methodology.dimensions.filter(d => d.critical);
    
    for (const dimension of criticalDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (!dimensionValue || !this.isDimensionComplete(dimensionValue, dimension)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check freshness failures
   */
  private checkFreshnessFailures(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): boolean {
    const requiredDimensions = methodology.dimensions.filter(d => d.required);
    
    for (const dimension of requiredDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (dimensionValue) {
        const ttlHours = dimension.ttl_days * 24;
        if (dimensionValue.freshness > ttlHours) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check provenance failures
   */
  private checkProvenanceFailures(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): boolean {
    const criticalDimensions = methodology.dimensions.filter(d => d.critical);
    
    for (const dimension of criticalDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (dimensionValue) {
        // NOTE: provenanceTrust is already an aggregated summary of all evidenceRefs.
        // It represents the highest-trust provenance class present in the evidence.
        // If provenanceTrust is AGENT_INFERENCE, it means ALL evidence is inference-only.
        // This is deterministic and correct for the current data model.
        if (dimensionValue.provenanceTrust === 'AGENT_INFERENCE') {
          return true;  // Critical dimension has only inference-based evidence
        }
      }
    }

    return false;
  }

  /**
   * Compute deterministic reason codes
   */
  private computeReasons(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology,
    criticalDimensionsComplete: boolean,
    failsDueToFreshness: boolean,
    failsDueToProvenance: boolean
  ): string[] {
    const reasons: string[] = [];

    // Check required dimensions
    const requiredDimensions = methodology.dimensions.filter(d => d.required);
    for (const dimension of requiredDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      if (!dimensionValue || !this.isDimensionComplete(dimensionValue, dimension)) {
        reasons.push(`REQUIRED_DIM_MISSING_${dimension.dimension_key}`);
      }
    }

    // Check critical dimensions
    if (!criticalDimensionsComplete) {
      const criticalDimensions = methodology.dimensions.filter(d => d.critical);
      for (const dimension of criticalDimensions) {
        const dimensionValue = dimensions[dimension.dimension_key];
        if (!dimensionValue || !this.isDimensionComplete(dimensionValue, dimension)) {
          if (dimensionValue && dimensionValue.provenanceTrust === 'AGENT_INFERENCE') {
            reasons.push(`CRITICAL_DIM_INFERENCE_ONLY_${dimension.dimension_key}`);
          } else {
            reasons.push(`CRITICAL_DIM_INCOMPLETE_${dimension.dimension_key}`);
          }
        }
      }
    }

    // Check freshness
    if (failsDueToFreshness) {
      for (const dimension of requiredDimensions) {
        const dimensionValue = dimensions[dimension.dimension_key];
        if (dimensionValue) {
          const ttlHours = dimension.ttl_days * 24;
          if (dimensionValue.freshness > ttlHours) {
            reasons.push(`DIM_STALE_${dimension.dimension_key}`);
          }
        }
      }
    }

    // Check provenance
    if (failsDueToProvenance) {
      const criticalDimensions = methodology.dimensions.filter(d => d.critical);
      for (const dimension of criticalDimensions) {
        const dimensionValue = dimensions[dimension.dimension_key];
        if (dimensionValue && dimensionValue.provenanceTrust === 'AGENT_INFERENCE') {
          reasons.push(`CRITICAL_DIM_INFERENCE_ONLY_${dimension.dimension_key}`);
        }
      }
    }

    // Check low confidence
    for (const dimension of methodology.dimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      if (dimensionValue && dimensionValue.confidence < dimension.min_confidence_autonomous) {
        reasons.push(`DIM_LOW_CONFIDENCE_${dimension.dimension_key}`);
      }
    }

    return reasons;
  }
}
