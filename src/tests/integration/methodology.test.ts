import { MethodologyService } from '../../services/methodology/MethodologyService';
import { AssessmentService } from '../../services/methodology/AssessmentService';
import { AssessmentComputationService } from '../../services/methodology/AssessmentComputationService';
import { SchemaRegistryService } from '../../services/world-model/SchemaRegistryService';
import { WorldStateService } from '../../services/world-model/WorldStateService';
import { Logger } from '../../services/core/Logger';
import { CreateMethodologyInput } from '../../types/MethodologyTypes';
import { CreateAssessmentInput, UpdateAssessmentInput } from '../../types/AssessmentTypes';
import { EntityState } from '../../types/WorldStateTypes';
import { mockDynamoDBDocumentClient, mockS3Client, resetAllMocks } from '../__mocks__/aws-sdk-clients';
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
  UpdateCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

describe('Methodology Integration Tests', () => {
  let methodologyService: MethodologyService;
  let assessmentService: AssessmentService;
  let logger: Logger;
  let schemaRegistryService: SchemaRegistryService;
  let worldStateService: jest.Mocked<WorldStateService>;
  let meddiccFixture: any;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('IntegrationTest');

    // Load MEDDICC fixture
    const fixturePath = path.join(__dirname, '../fixtures/methodology/meddicc-baseline.json');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf-8');
    meddiccFixture = JSON.parse(fixtureContent);

    // Setup SchemaRegistryService
    schemaRegistryService = new SchemaRegistryService(
      logger,
      'test-schema-bucket',
      'test-schema-registry-table',
      'test-critical-fields-table',
      'us-west-2'
    );

    // Mock SchemaRegistryService methods
    (schemaRegistryService.registerSchema as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    (schemaRegistryService.getSchema as jest.Mock) = jest.fn().mockImplementation(async (entityType, version) => {
      if (entityType === 'SalesMethodology' && version) {
        return {
          ...meddiccFixture,
          tenantId: meddiccFixture.tenant_id,
        };
      }
      return null;
    });

    // Setup MethodologyService
    methodologyService = new MethodologyService(
      logger,
      schemaRegistryService,
      'test-methodology-table',
      'test-schema-bucket',
      'us-west-2'
    );

    // Setup WorldStateService mock
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

    // Setup AssessmentService
    const computationService = new AssessmentComputationService(logger);
    assessmentService = new AssessmentService(
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

  describe('Full Workflow: Create Methodology → Create Assessment → Update → Compute', () => {
    it('should complete full workflow successfully', async () => {
      // 1. Create methodology
      const methodologyInput: CreateMethodologyInput = {
        methodology_id: 'meth:test',
        name: 'Test MEDDICC',
        description: 'Test methodology',
        dimensions: meddiccFixture.dimensions,
        scoring_model: meddiccFixture.scoring_model,
        autonomy_gates: meddiccFixture.autonomy_gates,
        tenant_id: 'tenant:test',
      };

      mockS3Client.send.mockResolvedValue({});
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const methodology = await methodologyService.createMethodology(methodologyInput);

      expect(methodology.methodology_id).toBe('meth:test');
      expect(methodology.version).toBeDefined();
      expect(methodology.schema_hash).toBeDefined();

      // 2. Create assessment
      const assessmentInput: CreateAssessmentInput = {
        opportunity_id: 'test-123',
        methodology_id: 'meth:test',
        methodology_version: methodology.version,
        tenant_id: 'tenant:test',
      };

      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({}) // createAssessment store
        .mockResolvedValueOnce({ Item: null }) // getActiveAssessment
        .mockResolvedValueOnce({}); // updateAssessment store

      const assessment = await assessmentService.createAssessment(assessmentInput);

      expect(assessment.assessment_id).toBeDefined();
      expect(assessment.status).toBe('DRAFT');
      expect(assessment.computed.completeness).toBe(0);

      // 3. Update assessment with dimensions
      const updates: UpdateAssessmentInput = {
        dimensions: {
          metrics: {
            value: { defined: true, baseline: '1000 users' },
            confidence: 0.90,
            freshness: 10,
            contradiction: 0,
            provenanceTrust: 'PRIMARY',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [
              {
                type: 'external',
                location: 'opportunity:test-123:metrics',
                timestamp: new Date().toISOString(),
              },
            ],
          },
          economic_buyer: {
            value: { contact_id: 'contact:buyer-123' },
            confidence: 0.95,
            freshness: 5,
            contradiction: 0,
            provenanceTrust: 'PRIMARY',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [],
          },
        },
      };

      // Mock getAssessment for updateAssessment
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: { assessment } }) // getAssessment
        .mockResolvedValueOnce({ Items: [] }) // getActiveAssessment (no existing)
        .mockResolvedValueOnce({}); // storeAssessment

      const updated = await assessmentService.updateAssessment(
        assessment.assessment_id,
        updates,
        'tenant:test'
      );

      expect(updated.dimensions.metrics).toBeDefined();
      expect(updated.dimensions.economic_buyer).toBeDefined();
      expect(updated.computed.completeness).toBeGreaterThan(0);
      expect(updated.computed.quality_score).toBeGreaterThan(0);
      expect(updated.status).toBe('ACTIVE'); // Auto-activated
    });
  });

  describe('Assessment Supersession', () => {
    it('should supersede old assessment when new one activates', async () => {
      // Create first assessment
      const assessment1Input: CreateAssessmentInput = {
        opportunity_id: 'test-123',
        methodology_id: 'meth:test',
        methodology_version: '2026-01-v1',
        tenant_id: 'tenant:test',
      };

      const assessment1 = {
        assessment_id: 'assessment-1',
        tenantId: 'tenant:test',
        opportunity_id: 'test-123',
        methodology_id: 'meth:test',
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
          completeness: 0.14,
          quality_score: 0.90,
          critical_dimensions_complete: false,
          fails_due_to_freshness: false,
          fails_due_to_provenance: false,
          recommended_autonomy_tier_cap: 'TIER_C',
          reasons: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Create second assessment
      const assessment2 = {
        assessment_id: 'assessment-2',
        tenantId: 'tenant:test',
        opportunity_id: 'test-123',
        methodology_id: 'meth:test',
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

      // Mock updateAssessment flow: getAssessment -> getActiveAssessment (finds assessment1) -> supersede -> store
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: { assessment: assessment2 } }) // getAssessment
        .mockResolvedValueOnce({ Items: [{ assessment: assessment1 }] }) // getActiveAssessment (finds existing active)
        .mockResolvedValueOnce({ Item: { assessment: assessment1 } }) // supersedeAssessment getAssessment
        .mockResolvedValueOnce({}) // supersedeAssessment storeAssessment
        .mockResolvedValueOnce({}); // updateAssessment storeAssessment

      const updates: UpdateAssessmentInput = {
        dimensions: {
          metrics: {
            value: { defined: true },
            confidence: 0.90,
            freshness: 5,
            contradiction: 0,
            provenanceTrust: 'PRIMARY',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [],
          },
        },
      };

      const updated = await assessmentService.updateAssessment(
        'assessment-2',
        updates,
        'tenant:test'
      );

      expect(updated.status).toBe('ACTIVE');
      // Verify supersedeAssessment was called (check mock calls)
      const supersedeCalls = mockDynamoDBDocumentClient.send.mock.calls.filter(
        (call: any) => call.input?.Key?.pk === 'ASSESSMENT#assessment-1'
      );
      expect(supersedeCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Autonomy Tier Cap Enforcement', () => {
    it('should compute correct tier cap based on methodology gates', async () => {
      const assessment = {
        assessment_id: 'test-123',
        tenantId: 'tenant:test',
        opportunity_id: 'opp-123',
        methodology_id: 'meth:meddicc',
        methodology_version: '2026-01-v1',
        status: 'ACTIVE',
        dimensions: {
          // Complete all required dimensions with high confidence
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
          decision_criteria: {
            value: { technical: ['security'] },
            confidence: 0.85,
            freshness: 3,
            contradiction: 0,
            provenanceTrust: 'VERIFIED',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [],
          },
          decision_process: {
            value: { steps: ['evaluation'] },
            confidence: 0.80,
            freshness: 2,
            contradiction: 0,
            provenanceTrust: 'VERIFIED',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [],
          },
          identify_pain: {
            value: { primary_pain: 'Manual processes' },
            confidence: 0.88,
            freshness: 1,
            contradiction: 0,
            provenanceTrust: 'PRIMARY',
            lastUpdated: new Date().toISOString(),
            evidenceRefs: [],
          },
          champion: {
            value: { contact_id: 'contact:champ' },
            confidence: 0.82,
            freshness: 4,
            contradiction: 0,
            provenanceTrust: 'VERIFIED',
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

      const meddiccMethodology = {
        ...meddiccFixture,
        tenantId: meddiccFixture.tenant_id,
      } as any;

      const computationService = new AssessmentComputationService(logger);
      const computed = await computationService.computeAssessment(assessment as any, meddiccMethodology);

      // With all required dimensions complete and high quality, should meet Tier A gates
      expect(computed.completeness).toBeGreaterThan(0.8);
      expect(computed.quality_score).toBeGreaterThan(0.75);
      expect(computed.critical_dimensions_complete).toBe(true);
      expect(computed.recommended_autonomy_tier_cap).toBe('TIER_A');
    });
  });
});
