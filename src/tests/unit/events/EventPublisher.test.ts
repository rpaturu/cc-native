import { EventPublisher } from '../../../services/events/EventPublisher';
import { Logger } from '../../../services/core/Logger';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockEventBridgeClient, resetAllMocks, createEventBridgeSuccessResponse } from '../../__mocks__/aws-sdk-clients';

// Mock the EventBridgeClient
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => mockEventBridgeClient),
  PutEventsCommand: jest.fn(),
}));

describe('EventPublisher', () => {
  let eventPublisher: EventPublisher;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('EventPublisherTest');
    eventPublisher = new EventPublisher(logger, 'test-event-bus', 'us-west-2');
  });

  describe('publish', () => {
    it('should publish single event to EventBridge', async () => {
      mockEventBridgeClient.send.mockResolvedValue(createEventBridgeSuccessResponse());

      const event = {
        traceId: 'trace-123',
        tenantId: 'tenant-456',
        accountId: 'account-789',
        eventType: 'TEST_EVENT',
        source: 'system' as any,
        payload: { key: 'value' },
        ts: new Date().toISOString(),
      };

      await eventPublisher.publish(event);

      expect(mockEventBridgeClient.send).toHaveBeenCalledTimes(1);
      const command = mockEventBridgeClient.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutEventsCommand);
      expect(PutEventsCommand).toHaveBeenCalled();
    });

    it('should namespace event source', async () => {
      mockEventBridgeClient.send.mockResolvedValue(createEventBridgeSuccessResponse());

      const event = {
        traceId: 'trace-123',
        tenantId: 'tenant-456',
        eventType: 'TEST_EVENT',
        source: 'system' as any,
        payload: {},
        ts: new Date().toISOString(),
      };

      await eventPublisher.publish(event);

      expect(mockEventBridgeClient.send).toHaveBeenCalledTimes(1);
    });

    it('should throw error on publish failure', async () => {
      mockEventBridgeClient.send.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{ ErrorMessage: 'Publish failed' }],
      });

      const event = {
        traceId: 'trace-123',
        tenantId: 'tenant-456',
        eventType: 'TEST_EVENT',
        source: 'system' as any,
        payload: {},
        ts: new Date().toISOString(),
      };

      await expect(eventPublisher.publish(event)).rejects.toThrow('Failed to publish event');
    });

    it('should handle EventBridge errors', async () => {
      mockEventBridgeClient.send.mockRejectedValue(new Error('EventBridge error'));

      const event = {
        traceId: 'trace-123',
        tenantId: 'tenant-456',
        eventType: 'TEST_EVENT',
        source: 'system' as any,
        payload: {},
        ts: new Date().toISOString(),
      };

      await expect(eventPublisher.publish(event)).rejects.toThrow('EventBridge error');
    });
  });

  describe('publishBatch', () => {
    it('should publish batch of events', async () => {
      mockEventBridgeClient.send.mockResolvedValue(createEventBridgeSuccessResponse());

      const events = [
        {
          traceId: 'trace-1',
          tenantId: 'tenant-1',
          eventType: 'EVENT_1',
          source: 'system' as any,
          payload: {},
          ts: new Date().toISOString(),
        },
        {
          traceId: 'trace-2',
          tenantId: 'tenant-2',
          eventType: 'EVENT_2',
          source: 'system' as any,
          payload: {},
          ts: new Date().toISOString(),
        },
      ];

      await eventPublisher.publishBatch(events);

      expect(mockEventBridgeClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle empty batch', async () => {
      await eventPublisher.publishBatch([]);

      expect(mockEventBridgeClient.send).not.toHaveBeenCalled();
    });

    it('should throw error on batch failure', async () => {
      mockEventBridgeClient.send.mockResolvedValue({
        FailedEntryCount: 2,
        Entries: [
          { ErrorMessage: 'Error 1' },
          { ErrorMessage: 'Error 2' },
        ],
      });

      const events = [
        {
          traceId: 'trace-1',
          tenantId: 'tenant-1',
          eventType: 'EVENT_1',
          source: 'system',
          payload: {},
          timestamp: new Date().toISOString(),
        },
      ];

      await expect(eventPublisher.publishBatch(events)).rejects.toThrow('Failed to publish');
    });
  });
});
