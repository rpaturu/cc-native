/**
 * Mock AWS SDK clients for unit testing
 */

// Mock DynamoDB Document Client
export const mockDynamoDBDocumentClient = {
  send: jest.fn(),
};

// Mock S3 Client
export const mockS3Client = {
  send: jest.fn(),
};

// Mock EventBridge Client
export const mockEventBridgeClient = {
  send: jest.fn(),
};

// Helper to reset all mocks
export function resetAllMocks() {
  mockDynamoDBDocumentClient.send.mockReset();
  mockS3Client.send.mockReset();
  mockEventBridgeClient.send.mockReset();
}

// Helper to create successful DynamoDB responses
export function createDynamoDBSuccessResponse(item?: any) {
  return {
    Items: item ? [item] : [],
    Count: item ? 1 : 0,
    ScannedCount: item ? 1 : 0,
  };
}

// Helper to create successful S3 responses
export function createS3SuccessResponse(body?: string) {
  return {
    Body: {
      transformToString: jest.fn().mockResolvedValue(body || '{}'),
    },
    VersionId: 'version-123',
  };
}

// Helper to create successful EventBridge responses
export function createEventBridgeSuccessResponse() {
  return {
    FailedEntryCount: 0,
    Entries: [],
  };
}
