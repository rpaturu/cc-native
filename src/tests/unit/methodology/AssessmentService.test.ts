import { AssessmentService } from '../../../services/methodology/AssessmentService';
import { AssessmentComputationService } from '../../../services/methodology/AssessmentComputationService';
import { MethodologyService } from '../../../services/methodology/MethodologyService';
import { WorldStateService } from '../../../services/world-model/WorldStateService';
import { Logger } from '../../../services/core/Logger';
import { CreateAssessmentInput, UpdateAssessmentInput, DimensionValue } from '../../../types/AssessmentTypes';
import { SalesMethodology } from '../../../types/MethodologyTypes';
import { EntityState } from '../../../types/WorldStateTypes';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import * as fs from 'fs';
import * as path from 'path';

// Mock AWS SDK clients
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('AssessmentService', () => {
  let service: AssessmentService;
  let logger: Logger;
  let methodologyService: jest.Mocked<MethodologyService>;
  let computationService: AssessmentComputationService;
  let worldStateService: jest.Mocked<WorldStateService>;
  let meddiccMethodology: SalesMethodology;
  let mockOpportunity: EntityState;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('Test');
    
    // Load MEDDICC methodology fixture
    const fixturePath = path.join(__dirname, '../../fixtures/methodology/meddicc-baseline.json');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf-8');
    const fixture = JSON.parse(fixtureContent);
    meddiccMethodology = {
      ...fixture,
      tenantId: fixture.tenant_id,
    } as SalesMethodology;

    // Mock services
    methodologyService = {
      getMethodology: jest.fn().mockResolvedValue(meddiccMethodology),
    } as any;

    computationService = new AssessmentComputationService(logger);

    worldStateService = {
      getState: jest.fn().mockResolvedValue({
        entityId: 'opportunity:test-123',
        entityType: 'Opportunity',
        tenantId: 'tenant:test',
        fields: {},
        computedAt: new Date().toISOString(),
        autonomyTier: 'TIER_C',
        overallConfidence: 0.5,
        overallFreshness: 100,
        overallContradiction: 0,
      } as EntityState),
    } as any;

    service = new AssessmentService(
      logger,
      methodologyService,
      computationService,
      worldStateService,
      'test-assessment-table',
      'us-west-2'
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAssessment', () => {
    it('should create assessment with empty dimensions', async () => {
      const input: CreateAssessmentInput = {
        opportunity_id: 'test-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        tenant_id: 'tenant:test',
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.createAssessment(input);

      expect(result.assessment_id).toBeDefined();
      expect(result.status).toBe('DRAFT');
      expect(result.dimensions).toEqual({});
      expect(result.computed.completeness).toBe(0);
      expect(methodologyService.getMethodology).toHaveBeenCalled();
      expect(worldStateService.getState).toHaveBeenCalled();
    });

    it('should throw error when methodology not found', async () => {
      const input: CreateAssessmentInput = {
        opportunity_id: 'test-123',
        methodology_id: 'meth:notfound',
        methodology_version: '2026-01-v1',
        tenant_id: 'tenant:test',
      };

      methodologyService.getMethodology.mockResolvedValue(null);

      await expect(service.createAssessment(input)).rejects.toThrow('METHODOLOGY_NOT_FOUND');
    });

    it('should throw error when opportunity not found', async () => {
      const input: CreateAssessmentInput = {
        opportunity_id: 'test-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        tenant_id: 'tenant:test',
      };

      worldStateService.getState.mockResolvedValue(null);

      await expect(service.createAssessment(input)).rejects.toThrow('OPPORTUNITY_NOT_FOUND');
    });

    it('should throw error when methodology is deprecated', async () => {
      const input: CreateAssessmentInput = {
        opportunity_id: 'test-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        tenant_id: 'tenant:test',
      };

      methodologyService.getMethodology.mockResolvedValue({
        ...meddiccMethodology,
        status: 'DEPRECATED',
      });

      await expect(service.createAssessment(input)).rejects.toThrow('METHODOLOGY_DEPRECATED');
    });
  });

  describe('getAssessment', () => {
    it('should return assessment when found', async () => {
      const assessment = {
        assessment_id: 'test-123',
        tenantId: 'tenant:test',
        opportunity_id: 'opp-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'ACTIVE',
        dimensions: {},
        computed: {
          completeness: 0.5,
          quality_score: 0.6,
          critical_dimensions_complete: false,
          fails_due_to_freshness: false,
          fails_due_to_provenance: false,
          recommended_autonomy_tier_cap: 'TIER_C',
          reasons: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: { assessment },
      });

      const result = await service.getAssessment('test-123', 'tenant:test');

      expect(result).toBeDefined();
      expect(result?.assessment_id).toBe('test-123');
    });

    it('should return null when assessment not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.getAssessment('notfound', 'tenant:test');

      expect(result).toBeNull();
    });

    it('should return null when tenant mismatch', async () => {
      const assessment = {
        assessment_id: 'test-123',
        tenantId: 'tenant:different',
        opportunity_id: 'opp-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'ACTIVE',
        dimensions: {},
        computed: {
          completeness: 0.5,
          quality_score: 0.6,
          critical_dimensions_complete: false,
          fails_due_to_freshness: false,
          fails_due_to_provenance: false,
          recommended_autonomy_tier_cap: 'TIER_C',
          reasons: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: { assessment },
      });

      const result = await service.getAssessment('test-123', 'tenant:test');

      expect(result).toBeNull();
    });
  });

  describe('updateAssessment', () => {
    it('should update dimensions and recompute metrics', async () => {
      const existingAssessment = {
        assessment_id: 'test-123',
        tenantId: 'tenant:test',
        opportunity_id: 'opp-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'DRAFT',
        dimensions: {},
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

      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: { assessment: existingAssessment } }) // getAssessment
        .mockResolvedValueOnce({}) // getActiveAssessment (no existing active)
        .mockResolvedValueOnce({}); // storeAssessment

      const updates: UpdateAssessmentInput = {
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
      };

      const result = await service.updateAssessment('test-123', updates, 'tenant:test');

      expect(result.dimensions.metrics).toBeDefined();
      expect(result.computed.completeness).toBeGreaterThan(0);
      expect(result.status).toBe('ACTIVE'); // Auto-activated when dimensions added
    });

    it('should throw error when assessment not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await expect(
        service.updateAssessment('notfound', { dimensions: {} }, 'tenant:test')
      ).rejects.toThrow('ASSESSMENT_NOT_FOUND');
    });

    it('should throw error for invalid dimension key', async () => {
      const existingAssessment = {
        assessment_id: 'test-123',
        tenantId: 'tenant:test',
        opportunity_id: 'opp-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'DRAFT',
        dimensions: {},
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

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: { assessment: existingAssessment },
      });

      const updates: UpdateAssessmentInput = {
        dimensions: {
          invalid_dimension: {
            value: 'test',
            confidence: 0.9,
            freshness: 10,
            contradiction: 0,
            provenanceTrust: 'PRIMARY',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [],
          },
        },
      };

      await expect(
        service.updateAssessment('test-123', updates, 'tenant:test')
      ).rejects.toThrow('INVALID_DIMENSION_KEY');
    });
  });

  describe('getActiveAssessment', () => {
    it('should return active assessment when found', async () => {
      const assessment = {
        assessment_id: 'test-123',
        tenantId: 'tenant:test',
        opportunity_id: 'opp-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'ACTIVE',
        dimensions: {},
        computed: {
          completeness: 0.5,
          quality_score: 0.6,
          critical_dimensions_complete: false,
          fails_due_to_freshness: false,
          fails_due_to_provenance: false,
          recommended_autonomy_tier_cap: 'TIER_C',
          reasons: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [{ assessment }],
      });

      const result = await service.getActiveAssessment('opp-123', 'meth:meddicc', 'tenant:test');

      expect(result).toBeDefined();
      expect(result?.status).toBe('ACTIVE');
    });

    it('should return null when no active assessment found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.getActiveAssessment('opp-123', 'meth:meddicc', 'tenant:test');

      expect(result).toBeNull();
    });
  });

  describe('supersedeAssessment', () => {
    it('should mark assessment as SUPERSEDED', async () => {
      const assessment = {
        assessment_id: 'old-123',
        tenantId: 'tenant:test',
        opportunity_id: 'opp-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'ACTIVE',
        dimensions: {},
        computed: {
          completeness: 0.5,
          quality_score: 0.6,
          critical_dimensions_complete: false,
          fails_due_to_freshness: false,
          fails_due_to_provenance: false,
          recommended_autonomy_tier_cap: 'TIER_C',
          reasons: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: { assessment } }) // getAssessment
        .mockResolvedValueOnce({}); // storeAssessment

      await service.supersedeAssessment('old-123', 'new-456', 'tenant:test');

      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
    });
  });
});
