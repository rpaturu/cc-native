import { TraceService } from '../../../services/core/TraceService';
import { Logger } from '../../../services/core/Logger';
import { TraceContext } from '../../../types/CommonTypes';

describe('TraceService', () => {
  let traceService: TraceService;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('TraceServiceTest');
    traceService = new TraceService(logger);
  });

  describe('generateTraceId', () => {
    it('should generate unique trace IDs', () => {
      const traceId1 = traceService.generateTraceId();
      const traceId2 = traceService.generateTraceId();

      expect(traceId1).toBeDefined();
      expect(traceId2).toBeDefined();
      expect(traceId1).not.toBe(traceId2);
      expect(traceId1).toMatch(/^trace-[a-f0-9-]+$/);
    });

    it('should generate trace IDs with correct format', () => {
      const traceId = traceService.generateTraceId();
      expect(traceId).toMatch(/^trace-/);
      expect(traceId.length).toBeGreaterThan(10);
    });
  });

  describe('extractFromHeaders', () => {
    it('should extract traceId and tenantId from headers (lowercase)', () => {
      const headers = {
        'x-trace-id': 'trace-123',
        'x-tenant-id': 'tenant-456',
      };

      const context = traceService.extractFromHeaders(headers);

      expect(context.traceId).toBe('trace-123');
      expect(context.tenantId).toBe('tenant-456');
    });

    it('should extract traceId and tenantId from headers (mixed case)', () => {
      const headers = {
        'X-Trace-Id': 'trace-123',
        'X-Tenant-Id': 'tenant-456',
      };

      const context = traceService.extractFromHeaders(headers);

      expect(context.traceId).toBe('trace-123');
      expect(context.tenantId).toBe('tenant-456');
    });

    it('should handle missing headers', () => {
      const headers = {};

      const context = traceService.extractFromHeaders(headers);

      expect(context.traceId).toBeUndefined();
      expect(context.tenantId).toBeUndefined();
    });

    it('should handle partial headers', () => {
      const headers = {
        'x-trace-id': 'trace-123',
      };

      const context = traceService.extractFromHeaders(headers);

      expect(context.traceId).toBe('trace-123');
      expect(context.tenantId).toBeUndefined();
    });
  });

  describe('extractFromEvent', () => {
    it('should extract traceId and tenantId from event', () => {
      const event = {
        traceId: 'trace-123',
        tenantId: 'tenant-456',
        eventType: 'TEST_EVENT',
        payload: {},
      };

      const context = traceService.extractFromEvent(event);

      expect(context.traceId).toBe('trace-123');
      expect(context.tenantId).toBe('tenant-456');
    });

    it('should handle missing fields in event', () => {
      const event = {
        eventType: 'TEST_EVENT',
        payload: {},
      };

      const context = traceService.extractFromEvent(event);

      expect(context.traceId).toBeUndefined();
      expect(context.tenantId).toBeUndefined();
    });
  });

  describe('withTrace', () => {
    it('should execute function with trace context', async () => {
      const context: TraceContext = {
        traceId: 'trace-123',
        tenantId: 'tenant-456',
      };

      const result = await traceService.withTrace(context, async (ctx) => {
        expect(ctx.traceId).toBe('trace-123');
        expect(ctx.tenantId).toBe('tenant-456');
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('should propagate errors', async () => {
      const context: TraceContext = {
        traceId: 'trace-123',
      };

      await expect(
        traceService.withTrace(context, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });
});
