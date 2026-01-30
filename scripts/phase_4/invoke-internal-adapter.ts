/**
 * Invoke Internal Adapter Lambda directly (same event + clientContext shape as Gateway).
 * Use this to verify the adapter works without going through the Gateway.
 *
 * Prerequisites: Deploy stack, then run from repo root:
 *   npx ts-node scripts/phase_4/invoke-internal-adapter.ts
 *
 * Optional env: LAMBDA_INTERNAL_ADAPTER (default: cc-native-internal-adapter-handler),
 *   AWS_REGION, AWS_PROFILE.
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ path: '.env.local' });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ path: '.env' });
} catch {
  // dotenv optional
}

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const FUNCTION_NAME = process.env.LAMBDA_INTERNAL_ADAPTER || 'cc-native-internal-adapter-handler';
const REGION = process.env.AWS_REGION || 'us-west-2';

// Event payload = tool arguments (same shape Gateway sends)
const eventPayload = {
  title: 'E2E test',
  description: 'Phase 4 E2E seed',
  tenant_id: 'test-tenant-1',
  account_id: 'test-account-1',
  idempotency_key: 'test-invoke-' + Date.now(),
  action_intent_id: 'ai_test_invoke_' + Date.now(),
};

// ClientContext.custom = what Gateway injects (tool name with target prefix)
const clientContext = {
  custom: {
    bedrockAgentCoreToolName: 'internal-create-task___internal.create_task',
    bedrockAgentCoreGatewayId: 'cc-native-execution-gateway-dgwyn9ujro',
    bedrockAgentCoreTargetId: '0XMV1D9CEV',
    bedrockAgentCoreMcpMessageId: 'invoke-direct-' + Date.now(),
  },
};

async function main() {
  const client = new LambdaClient({ region: REGION });
  const payloadStr = JSON.stringify(eventPayload);
  const clientContextB64 = Buffer.from(JSON.stringify(clientContext), 'utf-8').toString('base64');

  console.log('Invoking Internal Adapter Lambda:', FUNCTION_NAME);
  console.log('Event keys:', Object.keys(eventPayload));
  console.log('ClientContext.custom.bedrockAgentCoreToolName:', clientContext.custom.bedrockAgentCoreToolName);
  console.log('');

  const command = new InvokeCommand({
    FunctionName: FUNCTION_NAME,
    Payload: payloadStr,
    ClientContext: clientContextB64,
  });

  const start = Date.now();
  const response = await client.send(command);
  const elapsed = Date.now() - start;

  console.log('Lambda duration (ms):', elapsed);
  console.log('StatusCode:', response.StatusCode);
  if (response.FunctionError) {
    console.log('FunctionError:', response.FunctionError);
  }
  if (response.LogResult) {
    console.log('LogResult (base64):', response.LogResult);
  }

  const payload = response.Payload;
  if (!payload) {
    console.log('No payload in response.');
    return;
  }
  const resultStr = new TextDecoder().decode(payload);
  let result: any;
  try {
    result = JSON.parse(resultStr);
  } catch {
    console.log('Raw payload:', resultStr);
    return;
  }

  console.log('');
  console.log('Response (parsed):');
  console.log(JSON.stringify(result, null, 2));

  if (result.result?.content?.[0]?.text) {
    try {
      const inner = JSON.parse(result.result.content[0].text);
      console.log('');
      console.log('Inner result.content[0].text (parsed):');
      console.log(JSON.stringify(inner, null, 2));
      if (inner.success === false) {
        console.log('');
        console.log('-> Adapter returned error:', inner.error_message);
      } else if (inner.success === true) {
        console.log('');
        console.log('-> Adapter succeeded, external_object_refs:', inner.external_object_refs);
      }
    } catch {
      console.log('Inner text (raw):', result.result.content[0].text);
    }
  }
}

main().catch((err) => {
  console.error('Invoke failed:', err);
  process.exit(1);
});
