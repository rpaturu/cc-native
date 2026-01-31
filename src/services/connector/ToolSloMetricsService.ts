/**
 * Tool SLO Metrics Service - Phase 5.7
 *
 * Emits tool_latency_ms, tool_success, tool_error to CloudWatch.
 * tenant_id dimension on errors only (or 1% sampled successes) to avoid cost.
 *
 * Contract: PHASE_5_7_CODE_LEVEL_PLAN.md §2.
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { Logger } from '../core/Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const NAMESPACE = 'CCNative/Execution';
const SAMPLE_SUCCESS_RATE = 0.01;

export interface EmitToolMetricParams {
  toolName: string;
  connectorId: string;
  tenantId?: string;
  latencyMs: number;
  success: boolean;
}

export class ToolSloMetricsService {
  private readonly client: CloudWatchClient;

  constructor(
    private readonly logger: Logger,
    region?: string
  ) {
    this.client = new CloudWatchClient(getAWSClientConfig(region));
  }

  /**
   * Emit SLO metrics for one tool call. tenant_id on errors only or 1% of successes.
   */
  async emit(params: EmitToolMetricParams): Promise<void> {
    const { toolName, connectorId, tenantId, latencyMs, success } = params;
    const baseDimensions = [
      { Name: 'tool_name', Value: toolName },
      { Name: 'connector_id', Value: connectorId },
    ];
    const includeTenantId = !success || Math.random() < SAMPLE_SUCCESS_RATE;
    const dimensions = includeTenantId && tenantId
      ? [...baseDimensions, { Name: 'tenant_id', Value: tenantId }]
      : baseDimensions;

    const timestamp = new Date();
    const metrics: Array<{ Name: string; Value: number; Unit: StandardUnit }> = [
      { Name: 'tool_latency_ms', Value: latencyMs, Unit: StandardUnit.Milliseconds },
      { Name: success ? 'tool_success' : 'tool_error', Value: 1, Unit: StandardUnit.Count },
    ];

    try {
      await this.client.send(
        new PutMetricDataCommand({
          Namespace: NAMESPACE,
          MetricData: metrics.map((m) => ({
            MetricName: m.Name,
            Value: m.Value,
            Unit: m.Unit,
            Timestamp: timestamp,
            Dimensions: dimensions,
          })),
        })
      );
    } catch (e) {
      this.logger.warn('Failed to emit tool SLO metrics', {
        toolName,
        connectorId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
