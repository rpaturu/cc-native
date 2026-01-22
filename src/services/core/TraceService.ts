import { v4 as uuidv4 } from 'uuid';
import { TraceContext } from '../../types/CommonTypes';
import { Logger } from './Logger';

/**
 * TraceService - Trace ID generation and propagation
 * 
 * Note: For Node.js 18+, consider using AsyncLocalStorage for implicit trace propagation
 * to reduce manual context passing.
 */
export class TraceService {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Generate a new trace ID
   */
  generateTraceId(): string {
    return `trace-${Date.now()}-${uuidv4()}`;
  }

  /**
   * Create trace context from request
   */
  createContext(
    tenantId: string,
    accountId?: string,
    userId?: string,
    agentId?: string,
    existingTraceId?: string
  ): TraceContext {
    return {
      traceId: existingTraceId || this.generateTraceId(),
      tenantId,
      accountId,
      userId,
      agentId,
    };
  }

  /**
   * Extract trace context from headers/event
   * Normalizes header keys to lowercase for case-insensitive lookup
   * (API Gateway and ALB may normalize headers differently)
   */
  extractFromHeaders(headers: Record<string, string>): TraceContext | null {
    // Normalize header keys to lowercase
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    const traceId = normalizedHeaders['x-trace-id'];
    const tenantId = normalizedHeaders['x-tenant-id'];
    const accountId = normalizedHeaders['x-account-id'];
    const userId = normalizedHeaders['x-user-id'];
    const agentId = normalizedHeaders['x-agent-id'];

    if (!traceId || !tenantId) {
      return null;
    }

    return {
      traceId,
      tenantId,
      accountId,
      userId,
      agentId,
    };
  }

  /**
   * Extract trace context from Lambda event
   */
  extractFromEvent(event: any): TraceContext | null {
    // Try headers first (API Gateway)
    if (event.headers) {
      return this.extractFromHeaders(event.headers);
    }

    // Try requestContext (API Gateway v2)
    if (event.requestContext) {
      const headers = event.requestContext.headers || {};
      return this.extractFromHeaders(headers);
    }

    // Try direct properties (Step Functions, EventBridge)
    if (event.traceId && event.tenantId) {
      return {
        traceId: event.traceId,
        tenantId: event.tenantId,
        accountId: event.accountId,
        userId: event.userId,
        agentId: event.agentId,
      };
    }

    return null;
  }

  /**
   * Helper to run function with trace context (AsyncLocalStorage support for Node 18+)
   * 
   * Example usage:
   * await traceService.withTrace(context, async () => {
   *   // All code here has implicit access to trace context
   *   await someService.doSomething();
   * });
   */
  async withTrace<T>(
    context: TraceContext,
    fn: () => Promise<T>
  ): Promise<T> {
    // For now, just call the function
    // TODO: Implement AsyncLocalStorage when Node 18+ is confirmed
    return await fn();
  }
}
