import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventEnvelope, createEventSource } from '../../types/EventTypes';
import { Logger } from '../core/Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';

/**
 * EventPublisher - Publish events to EventBridge
 */
export class EventPublisher {
  private eventBridgeClient: EventBridgeClient;
  private logger: Logger;
  private eventBusName: string;

  constructor(logger: Logger, eventBusName: string, region?: string) {
    this.logger = logger;
    this.eventBusName = eventBusName;
    
    const clientConfig = getAWSClientConfig(region);
    this.eventBridgeClient = new EventBridgeClient(clientConfig);
  }

  /**
   * Publish single event to EventBridge
   */
  async publish(event: EventEnvelope): Promise<void> {
    try {
      const namespacedSource = createEventSource(event.source);
      
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: namespacedSource,
            DetailType: event.eventType,
            Detail: JSON.stringify(event),
            EventBusName: this.eventBusName,
          },
        ],
      });

      const result = await this.eventBridgeClient.send(command);
      
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        const error = result.Entries?.[0]?.ErrorMessage || 'Unknown error';
        throw new Error(`Failed to publish event: ${error}`);
      }

      this.logger.debug('Event published', {
        eventType: event.eventType,
        traceId: event.traceId,
        source: namespacedSource,
      });
    } catch (error) {
      this.logger.error('Failed to publish event', {
        eventType: event.eventType,
        traceId: event.traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Publish batch of events to EventBridge
   */
  async publishBatch(events: EventEnvelope[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    try {
      const entries = events.map(event => ({
        Source: createEventSource(event.source),
        DetailType: event.eventType,
        Detail: JSON.stringify(event),
        EventBusName: this.eventBusName,
      }));

      const command = new PutEventsCommand({
        Entries: entries,
      });

      const result = await this.eventBridgeClient.send(command);
      
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        const failedEntries = result.Entries?.filter(e => e.ErrorMessage) || [];
        const errors = failedEntries.map(e => e.ErrorMessage).join('; ');
        throw new Error(`Failed to publish ${result.FailedEntryCount} events: ${errors}`);
      }

      this.logger.debug('Events published (batch)', {
        count: events.length,
        traceIds: events.map(e => e.traceId),
      });
    } catch (error) {
      this.logger.error('Failed to publish event batch', {
        count: events.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
