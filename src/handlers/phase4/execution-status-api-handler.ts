/**
 * Execution Status API Handler - Phase 4.4
 *
 * GET /executions/{action_intent_id}/status — get execution status for a specific action intent.
 * GET /accounts/{account_id}/executions — list executions for an account (paginated).
 *
 * Auth: JWT authorizer; tenantId and account access derived from token claims (zero-trust).
 */

import {
  Handler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ExecutionStatus, ActionOutcomeV1 } from '../../types/ExecutionTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ExecutionStatusAPIHandler');

/**
 * Helper to validate required environment variables with descriptive errors.
 * Do not use this helper for AWS-provided runtime variables like AWS_REGION
 * (use process.env and a runtime-specific error message instead).
 */
function requireEnv(name: string, handlerName: string): string {
  const value = process.env[name];
  if (!value) {
    const error = new Error(
      `[${handlerName}] Missing required environment variable: ${name}. ` +
        `This variable must be set in the Lambda function configuration. ` +
        `Check CDK stack definition for ExecutionInfrastructure construct.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// AWS_REGION is set by Lambda runtime; do not use requireEnv for it (use runtime-specific message if missing).
const region: string =
  process.env.AWS_REGION ||
  (() => {
    const err = new Error(
      '[ExecutionStatusAPIHandler] AWS_REGION is not set. This is normally set by the Lambda runtime; check that the function is running in a Lambda environment.'
    );
    err.name = 'ConfigurationError';
    throw err;
  })();

const executionOutcomesTableName = requireEnv(
  'EXECUTION_OUTCOMES_TABLE_NAME',
  'ExecutionStatusAPIHandler'
);
const executionAttemptsTableName = requireEnv(
  'EXECUTION_ATTEMPTS_TABLE_NAME',
  'ExecutionStatusAPIHandler'
);
const actionIntentTableName = requireEnv(
  'ACTION_INTENT_TABLE_NAME',
  'ExecutionStatusAPIHandler'
);

const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient(clientConfig),
  { marshallOptions: { removeUndefinedValues: true } }
);

const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  executionOutcomesTableName,
  logger
);

const executionAttemptService = new ExecutionAttemptService(
  dynamoClient,
  executionAttemptsTableName,
  logger
);

const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

/**
 * Helper to add CORS headers.
 */
function addCorsHeaders(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Tenant-Id',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      ...response.headers,
    },
  };
}

/**
 * Derive tenantId (and optionally allowed account IDs) from JWT authorizer.
 * Do not trust x-tenant-id header for production.
 */
function getTenantFromAuthorizer(
  event: APIGatewayProxyEvent
): { tenantId: string; accountIds?: string[] } | null {
  const claims = event.requestContext?.authorizer?.claims as
    | Record<string, string>
    | undefined;
  if (!claims) return null;
  const tenantId = claims['custom:tenant_id'] ?? claims['tenant_id'];
  let accountIds: string[] | undefined;
  try {
    const raw = claims['custom:account_ids'];
    accountIds = raw ? (JSON.parse(raw) as string[]) : undefined;
  } catch {
    accountIds = undefined;
  }
  return tenantId ? { tenantId, accountIds } : null;
}

/** Map outcome/attempt status to API ExecutionStatus (RETRYING -> RUNNING). */
function toExecutionStatusStatus(
  s: ActionOutcomeV1['status'] | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
): ExecutionStatus['status'] {
  if (s === 'RETRYING') return 'RUNNING';
  return s as ExecutionStatus['status'];
}

/**
 * GET /executions/{action_intent_id}/status
 */
async function getExecutionStatusHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const auth = getTenantFromAuthorizer(event);
  if (!auth) {
    return addCorsHeaders({
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    });
  }
  const { tenantId, accountIds } = auth;
  const { action_intent_id } = event.pathParameters || {};
  const accountId = event.queryStringParameters?.account_id;

  if (!action_intent_id || !accountId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({
        error: 'Missing required parameters: action_intent_id, account_id',
      }),
    });
  }
  if (accountIds && !accountIds.includes(accountId)) {
    return addCorsHeaders({
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden' }),
    });
  }

  try {
    const attempt = await executionAttemptService.getAttempt(
      action_intent_id,
      tenantId,
      accountId
    );
    const outcome = await executionOutcomeService.getOutcome(
      action_intent_id,
      tenantId,
      accountId
    );
    const intent = await actionIntentService.getIntent(
      action_intent_id,
      tenantId,
      accountId
    );

    if (!outcome && !attempt && !intent) {
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Execution not found' }),
      });
    }

    let status: ExecutionStatus['status'] = 'PENDING';
    let startedAt: string | undefined;
    let completedAt: string | undefined;
    let externalObjectRefs: ExecutionStatus['external_object_refs'];
    let errorMessage: string | undefined;
    let errorClass: ExecutionStatus['error_class'];
    let attemptCount: number | undefined;

    if (outcome) {
      status = toExecutionStatusStatus(outcome.status);
      startedAt = outcome.started_at;
      completedAt = outcome.completed_at;
      externalObjectRefs = outcome.external_object_refs;
      errorMessage = outcome.error_message;
      errorClass = outcome.error_class;
      attemptCount = outcome.attempt_count;
    } else if (attempt) {
      status = attempt.status === 'RUNNING' ? 'RUNNING' : 'PENDING';
      startedAt = attempt.started_at;
    } else if (intent) {
      const now = Math.floor(Date.now() / 1000);
      status = intent.expires_at_epoch <= now ? 'EXPIRED' : 'PENDING';
    }

    const executionStatus: ExecutionStatus = {
      action_intent_id,
      status,
      started_at: startedAt,
      completed_at: completedAt,
      external_object_refs: externalObjectRefs,
      error_message: errorMessage,
      error_class: errorClass,
      attempt_count: attemptCount,
    };

    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify(executionStatus),
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get execution status', {
      action_intent_id,
      error: err.message,
    });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  }
}

/**
 * GET /accounts/{account_id}/executions
 */
async function listAccountExecutionsHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const auth = getTenantFromAuthorizer(event);
  if (!auth) {
    return addCorsHeaders({
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    });
  }
  const { tenantId, accountIds } = auth;
  const { account_id } = event.pathParameters || {};
  if (!account_id) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({
        error: 'Missing required parameter: account_id',
      }),
    });
  }
  if (accountIds && !accountIds.includes(account_id)) {
    return addCorsHeaders({
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden' }),
    });
  }

  const limitParam = event.queryStringParameters?.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (limitParam && (isNaN(limit) || limit < 1 || limit > 100)) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({
        error: 'Invalid limit parameter',
        message:
          'The limit query parameter must be a number between 1 and 100.',
        provided: limitParam,
      }),
    });
  }
  const nextToken = event.queryStringParameters?.next_token ?? undefined;

  try {
    const result = await executionOutcomeService.listOutcomes(
      tenantId,
      account_id,
      limit,
      nextToken
    );

    const executionStatuses: ExecutionStatus[] = result.items.map((outcome) => ({
      action_intent_id: outcome.action_intent_id,
      status: toExecutionStatusStatus(outcome.status),
      started_at: outcome.started_at,
      completed_at: outcome.completed_at,
      external_object_refs: outcome.external_object_refs,
      error_message: outcome.error_message,
      error_class: outcome.error_class,
      attempt_count: outcome.attempt_count,
    }));

    const body: { executions: ExecutionStatus[]; next_token?: string } = {
      executions: executionStatuses,
    };
    if (result.nextToken) body.next_token = result.nextToken;

    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list executions', { account_id, error: err.message });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  }
}

/**
 * Main handler - routes API Gateway requests
 */
export const handler: Handler<
  APIGatewayProxyEvent,
  APIGatewayProxyResult
> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { httpMethod, resource, path, pathParameters } = event;
  const route = resource || path;

  logger.info('Execution status API request received', {
    httpMethod,
    route,
    resource,
    path,
  });

  try {
    if (httpMethod === 'OPTIONS') {
      return addCorsHeaders({ statusCode: 200, body: '' });
    }

    if (
      httpMethod === 'GET' &&
      pathParameters?.action_intent_id &&
      route.includes('/executions/') &&
      route.includes('/status')
    ) {
      return await getExecutionStatusHandler(event);
    }

    if (
      httpMethod === 'GET' &&
      pathParameters?.account_id &&
      route.includes('/accounts/') &&
      route.includes('/executions')
    ) {
      return await listAccountExecutionsHandler(event);
    }

    logger.warn('Unknown route', { httpMethod, route, resource, path });
    return addCorsHeaders({
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found', path: route }),
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Handler routing failed', {
      error: err.message,
      httpMethod,
      route,
      resource,
      path,
    });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  };
};
