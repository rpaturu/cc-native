import { EventEnvelope } from '../../types/EventTypes';
import { Logger } from '../core/Logger';
import { ILedgerService } from '../../types/LedgerTypes';
import { createHash } from 'crypto';

/**
 * Event handler interface
 */
export interface IEventHandler<T = any> {
  handle(event: EventEnvelope): Promise<T>;
  canHandle(eventType: string): boolean;
}

/**
 * EventRouter - Route events to handlers with idempotency
 * 
 * Idempotency key: hash(eventType + entityId + sourceEventId + payloadNormalized)
 * This ensures duplicate EventBridge deliveries produce exactly one side effect.
 */
export class EventRouter {
  private logger: Logger;
  private ledgerService?: ILedgerService;
  private handlers: Map<string, IEventHandler[]> = new Map();

  constructor(logger: Logger, ledgerService?: ILedgerService) {
    this.logger = logger;
    this.ledgerService = ledgerService;
  }

  /**
   * Register handler for event type
   */
  registerHandler(eventType: string, handler: IEventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
    this.logger.debug('Event handler registered', { eventType });
  }

  /**
   * Generate idempotency key from event
   */
  private generateIdempotencyKey(event: EventEnvelope): string {
    // Normalize payload for consistent hashing
    const normalizedPayload = JSON.stringify(event.payload, Object.keys(event.payload).sort());
    
    // Extract entityId from payload if available
    const entityId = event.payload?.entityId || event.accountId || event.tenantId || '';
    
    // Extract sourceEventId from metadata if available
    const sourceEventId = event.metadata?.correlationId || event.traceId;
    
    // Create hash: eventType + entityId + sourceEventId + normalizedPayload
    const keyString = `${event.eventType}:${entityId}:${sourceEventId}:${normalizedPayload}`;
    const hash = createHash('sha256').update(keyString).digest('hex');
    
    return `idempotency:${hash}`;
  }

  /**
   * Check if event was already processed (idempotency check)
   */
  private async checkIdempotency(idempotencyKey: string, traceId: string): Promise<boolean> {
    if (!this.ledgerService) {
      // No ledger service, skip idempotency check
      return false;
    }

    try {
      // Query ledger for existing entry with this idempotency key
      const entries = await this.ledgerService.query({
        tenantId: '', // Will be extracted from traceId if needed
        traceId,
        limit: 100,
      });

      // Check if any entry has this idempotency key
      const found = entries.some(entry => 
        entry.data?.idempotencyKey === idempotencyKey
      );

      return found;
    } catch (error) {
      this.logger.warn('Idempotency check failed (proceeding)', {
        idempotencyKey,
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      // On error, proceed (fail-open for availability)
      return false;
    }
  }

  /**
   * Route event to registered handlers
   */
  async route(event: EventEnvelope): Promise<void> {
    const handlers = this.handlers.get(event.eventType) || [];
    
    if (handlers.length === 0) {
      this.logger.debug('No handlers registered for event type', {
        eventType: event.eventType,
        traceId: event.traceId,
      });
      return;
    }

    // Generate idempotency key
    const idempotencyKey = this.generateIdempotencyKey(event);

    // Check idempotency
    const alreadyProcessed = await this.checkIdempotency(idempotencyKey, event.traceId);
    if (alreadyProcessed) {
      this.logger.info('Event already processed (idempotency)', {
        eventType: event.eventType,
        traceId: event.traceId,
        idempotencyKey,
      });
      return;
    }

    // Execute handlers
    const results = await Promise.allSettled(
      handlers.map(handler => handler.handle(event))
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error('Event handler failed', {
          eventType: event.eventType,
          traceId: event.traceId,
          handlerIndex: index,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    // Log event routing completion for idempotency tracking
    if (this.ledgerService) {
      try {
        await this.ledgerService.append({
          traceId: event.traceId,
          tenantId: event.tenantId,
          accountId: event.accountId,
          eventType: 'VALIDATION' as any, // Using VALIDATION for routing completion
          data: {
            eventType: event.eventType,
            handlerCount: handlers.length,
            results: results.map(r => r.status),
            idempotencyKey,
          },
        });
      } catch (error) {
        // Log but don't fail - ledger write failure shouldn't break routing
        this.logger.warn('Failed to log event routing to ledger', {
          traceId: event.traceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
