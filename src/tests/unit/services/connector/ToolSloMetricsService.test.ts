/**
 * ToolSloMetricsService Unit Tests - Phase 5.7
 */

import { ToolSloMetricsService } from '../../../../services/connector/ToolSloMetricsService';
import { Logger } from '../../../../services/core/Logger';
import { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-cloudwatch', () => {
  const actual = jest.requireActual('@aws-sdk/client-cloudwatch');
  return {
    ...actual,
    CloudWatchClient: jest.fn(() => ({ send: mockSend })),
    PutMetricDataCommand: jest.fn((opts: unknown) => ({ _opts: opts })),
  };
});
jest.mock('../../../../utils/aws-client-config', () => ({ getAWSClientConfig: jest.fn(() => ({})) }));

describe('ToolSloMetricsService', () => {
  let service: ToolSloMetricsService;
  let logger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new Logger('ToolSloMetricsServiceTest');
    service = new ToolSloMetricsService(logger, 'us-east-1');
  });

  describe('emit', () => {
    it('sends PutMetricDataCommand with tool_latency_ms and tool_success on success', async () => {
      mockSend.mockResolvedValue(undefined);
      await service.emit({
        toolName: 'internal.create_task',
        connectorId: 'internal',
        latencyMs: 100,
        success: true,
      });
      expect(PutMetricDataCommand).toHaveBeenCalled();
      const callArg = (PutMetricDataCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(callArg.Namespace).toBe('CCNative/Execution');
      expect(callArg.MetricData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ MetricName: 'tool_latency_ms', Value: 100 }),
          expect.objectContaining({ MetricName: 'tool_success', Value: 1 }),
        ])
      );
    });

    it('sends tool_error and includes tenant_id dimension on error', async () => {
      mockSend.mockResolvedValue(undefined);
      await service.emit({
        toolName: 'internal.create_task',
        connectorId: 'internal',
        tenantId: 'tenant-1',
        latencyMs: 50,
        success: false,
      });
      const callArg = (PutMetricDataCommand as unknown as jest.Mock).mock.calls[0][0];
      const errorMetric = callArg.MetricData.find((m: any) => m.MetricName === 'tool_error');
      expect(errorMetric).toBeDefined();
      expect(errorMetric.Value).toBe(1);
      expect(callArg.MetricData[0].Dimensions).toEqual(
        expect.arrayContaining([
          { Name: 'tool_name', Value: 'internal.create_task' },
          { Name: 'connector_id', Value: 'internal' },
          { Name: 'tenant_id', Value: 'tenant-1' },
        ])
      );
    });

    it('logs warn and does not throw when PutMetricData fails', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      mockSend.mockRejectedValue(new Error('CloudWatch error'));
      await service.emit({
        toolName: 'internal.create_task',
        connectorId: 'internal',
        latencyMs: 10,
        success: true,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to emit tool SLO metrics',
        expect.objectContaining({
          toolName: 'internal.create_task',
          connectorId: 'internal',
          error: 'CloudWatch error',
        })
      );
      warnSpy.mockRestore();
    });

    it('logs warn with String(e) when thrown value is not Error instance', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      mockSend.mockRejectedValue('non-Error string');
      await service.emit({
        toolName: 'internal.create_task',
        connectorId: 'internal',
        latencyMs: 10,
        success: true,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to emit tool SLO metrics',
        expect.objectContaining({
          toolName: 'internal.create_task',
          connectorId: 'internal',
          error: 'non-Error string',
        })
      );
      warnSpy.mockRestore();
    });
  });
});
