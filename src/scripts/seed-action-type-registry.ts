#!/usr/bin/env ts-node
/**
 * Seed Action Type Registry Data
 * 
 * Loads initial ActionTypeRegistry entries for connector adapters.
 * 
 * Usage:
 *   npm run seed:action-types [--region us-west-2]
 * 
 * Environment variables (from .env file):
 *   - ACTION_TYPE_REGISTRY_TABLE_NAME
 *   - AWS_REGION
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ActionTypeRegistryService } from '../services/execution/ActionTypeRegistryService';
import { Logger } from '../services/core/Logger';
import { getAWSClientConfig } from '../utils/aws-client-config';

// Load environment variables from .env file if it exists
if (fs.existsSync(path.join(__dirname, '../../.env'))) {
  dotenv.config({ path: path.join(__dirname, '../../.env') });
}

const logger = new Logger('SeedActionTypeRegistry');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry';
const service = new ActionTypeRegistryService(dynamoClient, tableName, logger);

/**
 * Seed ActionTypeRegistry entries
 */
async function seed(): Promise<void> {
  console.log(`🌱 Seeding ActionTypeRegistry entries...`);
  console.log(`   Table: ${tableName}`);
  console.log(`   Region: ${region}\n`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // CREATE_CRM_TASK → crm.create_task
  try {
    await service.registerMapping({
      action_type: 'CREATE_CRM_TASK',
      tool_name: 'crm.create_task',
      tool_schema_version: 'v1.0',
      required_scopes: ['salesforce_api'],
      risk_class: 'LOW',
      compensation_strategy: 'MANUAL', // ✅ MUST-FIX: Set to MANUAL until rollback implemented
      parameter_mapping: {
        title: {
          toolParam: 'title',
          transform: 'PASSTHROUGH',
          required: true,
        },
        priority: {
          toolParam: 'priority',
          transform: 'UPPERCASE',
          required: false,
        },
        description: {
          toolParam: 'description',
          transform: 'PASSTHROUGH',
          required: false,
        },
      },
    });
    console.log('✅ Seeded: CREATE_CRM_TASK → crm.create_task');
    successCount++;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException' || 
        (error instanceof Error && error.message.includes('already exists'))) {
      console.log('⏭️  Skipped (already exists): CREATE_CRM_TASK');
      skipCount++;
    } else {
      console.error(`❌ Failed to seed CREATE_CRM_TASK:`, error instanceof Error ? error.message : String(error));
      errorCount++;
    }
  }

  // CREATE_INTERNAL_NOTE → internal.create_note
  try {
    await service.registerMapping({
      action_type: 'CREATE_INTERNAL_NOTE',
      tool_name: 'internal.create_note',
      tool_schema_version: 'v1.0',
      required_scopes: [],
      risk_class: 'MINIMAL',
      compensation_strategy: 'AUTOMATIC', // Internal notes can be deleted
      parameter_mapping: {
        content: {
          toolParam: 'content',
          transform: 'PASSTHROUGH',
          required: true,
        },
      },
    });
    console.log('✅ Seeded: CREATE_INTERNAL_NOTE → internal.create_note');
    successCount++;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException' || 
        (error instanceof Error && error.message.includes('already exists'))) {
      console.log('⏭️  Skipped (already exists): CREATE_INTERNAL_NOTE');
      skipCount++;
    } else {
      console.error(`❌ Failed to seed CREATE_INTERNAL_NOTE:`, error instanceof Error ? error.message : String(error));
      errorCount++;
    }
  }

  // CREATE_INTERNAL_TASK → internal.create_task
  try {
    await service.registerMapping({
      action_type: 'CREATE_INTERNAL_TASK',
      tool_name: 'internal.create_task',
      tool_schema_version: 'v1.0',
      required_scopes: [],
      risk_class: 'MINIMAL',
      compensation_strategy: 'AUTOMATIC', // Internal tasks can be deleted
      parameter_mapping: {
        title: {
          toolParam: 'title',
          transform: 'PASSTHROUGH',
          required: true,
        },
        description: {
          toolParam: 'description',
          transform: 'PASSTHROUGH',
          required: false,
        },
      },
    });
    console.log('✅ Seeded: CREATE_INTERNAL_TASK → internal.create_task');
    successCount++;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException' || 
        (error instanceof Error && error.message.includes('already exists'))) {
      console.log('⏭️  Skipped (already exists): CREATE_INTERNAL_TASK');
      skipCount++;
    } else {
      console.error(`❌ Failed to seed CREATE_INTERNAL_TASK:`, error instanceof Error ? error.message : String(error));
      errorCount++;
    }
  }

  console.log('\n📊 Seeding Summary:');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skipCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);

  if (errorCount > 0) {
    throw new Error(`Failed to seed ${errorCount} action type(s)`);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  let customRegion = region;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--region' && i + 1 < args.length) {
      customRegion = args[i + 1];
      i++;
    }
  }

  // Validate required environment variables
  if (!tableName) {
    console.error('❌ Error: ACTION_TYPE_REGISTRY_TABLE_NAME environment variable is required');
    console.error('   Please ensure .env file exists with table name from CDK outputs');
    process.exit(1);
  }

  try {
    await seed();
    console.log('\n✅ ActionTypeRegistry seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ ActionTypeRegistry seeding failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
