/**
 * ConnectorConfigService Unit Tests - Phase 4.3
 */

import { ConnectorConfigService } from '../../../services/execution/ConnectorConfigService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import connectorConfigItem from '../../fixtures/execution/adapters/connector-config-dynamodb-item.json';

// Mock Secrets Manager Client
const mockSecretsManagerClient = {
  send: jest.fn(),
};

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => mockSecretsManagerClient),
  GetSecretValueCommand: jest.fn(),
}));

describe('ConnectorConfigService', () => {
  let service: ConnectorConfigService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('ConnectorConfigServiceTest');
    service = new ConnectorConfigService(
      mockDynamoDBDocumentClient as any,
      'test-connector-config-table',
      mockSecretsManagerClient as any,
      logger
    );
  });

  describe('getConnectorConfig', () => {
    describe('DynamoDB Config Retrieval', () => {
      it('should retrieve non-sensitive config from DynamoDB', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(GetCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            TableName: 'test-connector-config-table',
            Key: {
              pk: 'TENANT#tenant_test_1#ACCOUNT#account_test_1',
              sk: 'CONNECTOR#salesforce',
            },
          })
        );
        expect(config).toBeDefined();
        expect(config?.instanceUrl).toBe('https://test.salesforce.com');
        expect(config?.apiEndpoint).toBe('https://test.salesforce.com/services/data/v58.0');
      });

      it('should use correct partition key structure', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });

        await service.getConnectorConfig('tenant_test_1', 'account_test_1', 'salesforce');

        expect(GetCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            Key: {
              pk: 'TENANT#tenant_test_1#ACCOUNT#account_test_1',
              sk: 'CONNECTOR#salesforce',
            },
          })
        );
      });

      it('should return instanceUrl from DynamoDB item', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config?.instanceUrl).toBe('https://test.salesforce.com');
      });

      it('should return apiEndpoint from DynamoDB item', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config?.apiEndpoint).toBe('https://test.salesforce.com/services/data/v58.0');
      });

      it('should return null if config not found', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config).toBeNull();
      });
    });

    describe('Secrets Manager Retrieval', () => {
      it('should retrieve sensitive config from Secrets Manager', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        mockSecretsManagerClient.send.mockResolvedValue({
          SecretString: JSON.stringify({ apiKey: 'secret_api_key_123' }),
        });

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(GetSecretValueCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            SecretId: 'tenant/tenant_test_1/account/account_test_1/connector/salesforce',
          })
        );
        expect(config?.apiKey).toBe('secret_api_key_123');
      });

      it('should use account-specific secret ID', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        mockSecretsManagerClient.send.mockResolvedValue({
          SecretString: JSON.stringify({ apiKey: 'secret_key' }),
        });

        await service.getConnectorConfig('tenant_test_1', 'account_test_1', 'salesforce');

        expect(GetSecretValueCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            SecretId: 'tenant/tenant_test_1/account/account_test_1/connector/salesforce',
          })
        );
      });

      it('should parse JSON secret string', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        mockSecretsManagerClient.send.mockResolvedValue({
          SecretString: JSON.stringify({ apiKey: 'secret_key', otherField: 'value' }),
        });

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config?.apiKey).toBe('secret_key');
      });

      it('should handle ResourceNotFoundException gracefully', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        const notFoundError = new Error('Secret not found');
        (notFoundError as any).name = 'ResourceNotFoundException';
        mockSecretsManagerClient.send.mockRejectedValue(notFoundError);

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        // Should return config from DynamoDB even if secret not found
        expect(config).toBeDefined();
        expect(config?.instanceUrl).toBe('https://test.salesforce.com');
        expect(config?.apiKey).toBeUndefined();
      });

      it('should log warning for non-ResourceNotFound errors', async () => {
        const loggerSpy = jest.spyOn(logger, 'warn');
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        const otherError = new Error('Access denied');
        (otherError as any).name = 'AccessDeniedException';
        mockSecretsManagerClient.send.mockRejectedValue(otherError);

        await service.getConnectorConfig('tenant_test_1', 'account_test_1', 'salesforce');

        expect(loggerSpy).toHaveBeenCalledWith(
          'Failed to retrieve connector secret',
          expect.objectContaining({
            tenantId: 'tenant_test_1',
            accountId: 'account_test_1',
            connectorType: 'salesforce',
          })
        );
      });

      it('should NOT fall back to tenant-global secrets (account-specific only)', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        const notFoundError = new Error('Secret not found');
        (notFoundError as any).name = 'ResourceNotFoundException';
        mockSecretsManagerClient.send.mockRejectedValue(notFoundError);

        await service.getConnectorConfig('tenant_test_1', 'account_test_1', 'salesforce');

        // Should only call account-specific secret, not tenant-global
        expect(GetSecretValueCommand).toHaveBeenCalledTimes(1);
        expect(GetSecretValueCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            SecretId: 'tenant/tenant_test_1/account/account_test_1/connector/salesforce',
          })
        );
      });
    });

    describe('Combined Config', () => {
      it('should merge DynamoDB config with Secrets Manager config', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        mockSecretsManagerClient.send.mockResolvedValue({
          SecretString: JSON.stringify({ apiKey: 'secret_key' }),
        });

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config?.instanceUrl).toBe('https://test.salesforce.com');
        expect(config?.apiEndpoint).toBe('https://test.salesforce.com/services/data/v58.0');
        expect(config?.apiKey).toBe('secret_key');
      });

      it('should return null if both DynamoDB and Secrets Manager return empty', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});
        const notFoundError = new Error('Secret not found');
        (notFoundError as any).name = 'ResourceNotFoundException';
        mockSecretsManagerClient.send.mockRejectedValue(notFoundError);

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config).toBeNull();
      });

      it('should return config with only DynamoDB fields if secret not found', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: connectorConfigItem,
        });
        const notFoundError = new Error('Secret not found');
        (notFoundError as any).name = 'ResourceNotFoundException';
        mockSecretsManagerClient.send.mockRejectedValue(notFoundError);

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config?.instanceUrl).toBe('https://test.salesforce.com');
        expect(config?.apiKey).toBeUndefined();
      });

      it('should return config with only Secrets Manager fields if DynamoDB not found', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});
        mockSecretsManagerClient.send.mockResolvedValue({
          SecretString: JSON.stringify({ apiKey: 'secret_key' }),
        });

        const config = await service.getConnectorConfig(
          'tenant_test_1',
          'account_test_1',
          'salesforce'
        );

        expect(config?.apiKey).toBe('secret_key');
        expect(config?.instanceUrl).toBeUndefined();
      });
    });
  });
});
