#!/usr/bin/env ts-node
/**
 * Master Seed Script
 * 
 * Intelligently seeds all required data across all phases:
 * - Phase 0/1: Methodologies (MEDDIC, SPIN, Challenger)
 * - Phase 4.3: Action Type Registry (connector adapters)
 * 
 * Features:
 * - Checks if tables exist before seeding
 * - Idempotent (skips if data already exists)
 * - Can be run standalone or as part of deploy
 * - Provides detailed progress reporting
 * 
 * Usage:
 *   npm run seed:all [--skip-methodologies] [--skip-action-types] [--tenant-id tenant:global] [--region us-west-2]
 * 
 * Environment variables (from .env file):
 *   - METHODOLOGY_TABLE_NAME
 *   - SCHEMA_REGISTRY_BUCKET
 *   - SCHEMA_REGISTRY_TABLE_NAME
 *   - CRITICAL_FIELD_REGISTRY_TABLE_NAME
 *   - ACTION_TYPE_REGISTRY_TABLE_NAME
 *   - AWS_REGION
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ActionTypeRegistryService } from '../services/execution/ActionTypeRegistryService';
import { MethodologyService } from '../services/methodology/MethodologyService';
import { SchemaRegistryService } from '../services/world-model/SchemaRegistryService';
import { Logger } from '../services/core/Logger';
import { getAWSClientConfig } from '../utils/aws-client-config';

// Load environment variables from .env file if it exists
if (fs.existsSync(path.join(__dirname, '../../.env'))) {
  dotenv.config({ path: path.join(__dirname, '../../.env') });
}

const logger = new Logger('SeedAll');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

interface SeedOptions {
  skipMethodologies?: boolean;
  skipActionTypes?: boolean;
  tenantId?: string;
  region: string;
}

interface SeedResult {
  phase: string;
  success: boolean;
  seeded: number;
  skipped: number;
  errors: number;
  errorMessages?: string[];
}

/**
 * Check if a DynamoDB table exists
 */
async function tableExists(tableName: string): Promise<boolean> {
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      return false;
    }
    // Re-throw other errors (permissions, etc.)
    throw error;
  }
}

/**
 * Check if ActionTypeRegistry has any entries
 */
async function hasActionTypeRegistryEntries(tableName: string): Promise<boolean> {
  try {
    // Try to get one entry (any action type)
    const result = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: {
        action_type: 'CREATE_CRM_TASK', // Check for one of the expected entries
      },
    }));
    return !!result.Item;
  } catch (error: any) {
    // If table doesn't exist or entry doesn't exist, return false
    return false;
  }
}

/**
 * Seed methodologies (Phase 0/1)
 */
async function seedMethodologies(options: SeedOptions): Promise<SeedResult> {
  const result: SeedResult = {
    phase: 'Methodologies (Phase 0/1)',
    success: false,
    seeded: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const methodologyTableName = process.env.METHODOLOGY_TABLE_NAME;
  const schemaBucket = process.env.SCHEMA_REGISTRY_BUCKET;
  const schemaRegistryTableName = process.env.SCHEMA_REGISTRY_TABLE_NAME;
  const criticalFieldsTableName = process.env.CRITICAL_FIELD_REGISTRY_TABLE_NAME;

  // Validate required environment variables
  if (!methodologyTableName || !schemaBucket || !schemaRegistryTableName || !criticalFieldsTableName) {
    const missing = [];
    if (!methodologyTableName) missing.push('METHODOLOGY_TABLE_NAME');
    if (!schemaBucket) missing.push('SCHEMA_REGISTRY_BUCKET');
    if (!schemaRegistryTableName) missing.push('SCHEMA_REGISTRY_TABLE_NAME');
    if (!criticalFieldsTableName) missing.push('CRITICAL_FIELD_REGISTRY_TABLE_NAME');
    
    result.errorMessages?.push(`Missing required environment variables: ${missing.join(', ')}`);
    return result;
  }

  // Check if tables exist
  const tablesExist = await Promise.all([
    tableExists(methodologyTableName),
    tableExists(schemaRegistryTableName),
    tableExists(criticalFieldsTableName),
  ]);

  if (!tablesExist.every(exists => exists)) {
    const missingTables = [];
    if (!tablesExist[0]) missingTables.push(methodologyTableName);
    if (!tablesExist[1]) missingTables.push(schemaRegistryTableName);
    if (!tablesExist[2]) missingTables.push(criticalFieldsTableName);
    
    result.errorMessages?.push(`Required tables do not exist: ${missingTables.join(', ')}`);
    return result;
  }

  console.log(`\n🌱 Seeding ${result.phase}...`);
  console.log(`   Methodology Table: ${methodologyTableName}`);
  console.log(`   Schema Registry Table: ${schemaRegistryTableName}`);
  console.log(`   Schema Bucket: ${schemaBucket}`);

  try {
    // Import and use the methodology seeding logic
    const METHODOLOGY_FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/methodology');
    
    function loadMethodologyFixture(filename: string): any {
      const filePath = path.join(METHODOLOGY_FIXTURES_DIR, filename);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Methodology fixture not found: ${filePath}`);
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }

    const methodologies = [
      loadMethodologyFixture('meddicc-baseline.json'),
      loadMethodologyFixture('spin-baseline.json'),
      loadMethodologyFixture('challenger-baseline.json'),
    ];

    // Override tenant_id if provided
    if (options.tenantId) {
      methodologies.forEach(m => {
        m.tenant_id = options.tenantId!;
      });
    }

    const schemaRegistryService = new SchemaRegistryService(
      logger,
      schemaBucket,
      schemaRegistryTableName,
      criticalFieldsTableName,
      options.region
    );

    const methodologyService = new MethodologyService(
      logger,
      schemaRegistryService,
      methodologyTableName,
      schemaBucket,
      options.region
    );

    for (const methodology of methodologies) {
      try {
        const input = {
          methodology_id: methodology.methodology_id,
          name: methodology.name,
          description: methodology.description,
          dimensions: methodology.dimensions,
          scoring_model: methodology.scoring_model,
          autonomy_gates: methodology.autonomy_gates,
          tenant_id: methodology.tenant_id || options.tenantId || 'tenant:global',
        };

        await methodologyService.createMethodology(input);
        console.log(`   ✅ Seeded: ${methodology.methodology_id}`);
        result.seeded++;
      } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException' || 
            (error instanceof Error && error.message.includes('already exists'))) {
          console.log(`   ⏭️  Skipped (already exists): ${methodology.methodology_id}`);
          result.skipped++;
        } else {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`   ❌ Failed: ${methodology.methodology_id} - ${errorMsg}`);
          result.errors++;
          result.errorMessages?.push(`${methodology.methodology_id}: ${errorMsg}`);
        }
      }
    }

    result.success = result.errors === 0;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errorMessages?.push(`Fatal error: ${errorMsg}`);
    console.error(`   ❌ Fatal error: ${errorMsg}`);
  }

  return result;
}

/**
 * Seed Action Type Registry (Phase 4.3)
 */
async function seedActionTypeRegistry(options: SeedOptions): Promise<SeedResult> {
  const result: SeedResult = {
    phase: 'Action Type Registry (Phase 4.3)',
    success: false,
    seeded: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const tableName = process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry';

  console.log(`\n🌱 Seeding ${result.phase}...`);
  console.log(`   Table: ${tableName}`);

  // Validate required environment variables
  if (!tableName) {
    result.errorMessages?.push('Missing required environment variable: ACTION_TYPE_REGISTRY_TABLE_NAME');
    console.log('   ❌ Missing required environment variable: ACTION_TYPE_REGISTRY_TABLE_NAME');
    return result;
  }

  // Check if table exists - this is a hard requirement
  const exists = await tableExists(tableName);
  if (!exists) {
    const errorMsg = `ERROR: Required table does not exist: ${tableName}. ` +
      `ExecutionInfrastructure (Phase 4.1/4.3) must be deployed before seeding ActionTypeRegistry. ` +
      `Please add ExecutionInfrastructure to CCNativeStack and redeploy.`;
    result.errorMessages?.push(errorMsg);
    console.log(`   ❌ ${errorMsg}`);
    result.errors = 3; // All 3 action types failed
    return result;
  }

  try {
    const service = new ActionTypeRegistryService(docClient, tableName, logger);

    // CREATE_CRM_TASK → crm.create_task
    try {
      await service.registerMapping({
        action_type: 'CREATE_CRM_TASK',
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        required_scopes: ['salesforce_api'],
        risk_class: 'LOW',
        compensation_strategy: 'MANUAL',
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
      console.log('   ✅ Seeded: CREATE_CRM_TASK → crm.create_task');
      result.seeded++;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException' || 
          (error instanceof Error && error.message.includes('already exists'))) {
        console.log('   ⏭️  Skipped (already exists): CREATE_CRM_TASK');
        result.skipped++;
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ Failed: CREATE_CRM_TASK - ${errorMsg}`);
        result.errors++;
        result.errorMessages?.push(`CREATE_CRM_TASK: ${errorMsg}`);
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
        compensation_strategy: 'AUTOMATIC',
        parameter_mapping: {
          content: {
            toolParam: 'content',
            transform: 'PASSTHROUGH',
            required: true,
          },
        },
      });
      console.log('   ✅ Seeded: CREATE_INTERNAL_NOTE → internal.create_note');
      result.seeded++;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException' || 
          (error instanceof Error && error.message.includes('already exists'))) {
        console.log('   ⏭️  Skipped (already exists): CREATE_INTERNAL_NOTE');
        result.skipped++;
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ Failed: CREATE_INTERNAL_NOTE - ${errorMsg}`);
        result.errors++;
        result.errorMessages?.push(`CREATE_INTERNAL_NOTE: ${errorMsg}`);
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
        compensation_strategy: 'AUTOMATIC',
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
      console.log('   ✅ Seeded: CREATE_INTERNAL_TASK → internal.create_task');
      result.seeded++;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException' || 
          (error instanceof Error && error.message.includes('already exists'))) {
        console.log('   ⏭️  Skipped (already exists): CREATE_INTERNAL_TASK');
        result.skipped++;
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ Failed: CREATE_INTERNAL_TASK - ${errorMsg}`);
        result.errors++;
        result.errorMessages?.push(`CREATE_INTERNAL_TASK: ${errorMsg}`);
      }
    }

    result.success = result.errors === 0;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errorMessages?.push(`Fatal error: ${errorMsg}`);
    console.error(`   ❌ Fatal error: ${errorMsg}`);
  }

  return result;
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  const options: SeedOptions = {
    skipMethodologies: false,
    skipActionTypes: false,
    tenantId: 'tenant:global',
    region: process.env.AWS_REGION || 'us-west-2',
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip-methodologies') {
      options.skipMethodologies = true;
    } else if (args[i] === '--skip-action-types') {
      options.skipActionTypes = true;
    } else if (args[i] === '--tenant-id' && i + 1 < args.length) {
      options.tenantId = args[i + 1];
      i++;
    } else if (args[i] === '--region' && i + 1 < args.length) {
      options.region = args[i + 1];
      i++;
    }
  }

  console.log('🌱 Master Seed Script');
  console.log('====================');
  console.log(`   Region: ${options.region}`);
  console.log(`   Tenant ID: ${options.tenantId}`);
  console.log(`   Skip Methodologies: ${options.skipMethodologies}`);
  console.log(`   Skip Action Types: ${options.skipActionTypes}`);

  const results: SeedResult[] = [];

  // Seed methodologies
  if (!options.skipMethodologies) {
    const result = await seedMethodologies(options);
    results.push(result);
  } else {
    console.log('\n⏭️  Skipping methodologies (--skip-methodologies)');
  }

  // Seed action type registry
  if (!options.skipActionTypes) {
    const result = await seedActionTypeRegistry(options);
    results.push(result);
  } else {
    console.log('\n⏭️  Skipping action type registry (--skip-action-types)');
  }

  // Print summary
  console.log('\n📊 Seeding Summary');
  console.log('==================');
  
  let totalSeeded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let allSuccess = true;

  for (const result of results) {
    console.log(`\n${result.phase}:`);
    console.log(`   ✅ Seeded: ${result.seeded}`);
    console.log(`   ⏭️  Skipped: ${result.skipped}`);
    console.log(`   ❌ Errors: ${result.errors}`);
    
    if (result.errorMessages && result.errorMessages.length > 0) {
      result.errorMessages.forEach(msg => console.log(`      - ${msg}`));
    }

    totalSeeded += result.seeded;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
    
    if (!result.success) {
      allSuccess = false;
    }
  }

  console.log('\n📈 Overall Summary:');
  console.log(`   ✅ Total Seeded: ${totalSeeded}`);
  console.log(`   ⏭️  Total Skipped: ${totalSkipped}`);
  console.log(`   ❌ Total Errors: ${totalErrors}`);

  if (allSuccess && totalErrors === 0) {
    console.log('\n✅ All seeding completed successfully!');
    process.exit(0);
  } else {
    console.log('\n❌ Seeding failed. Review errors above.');
    console.log('   Missing tables indicate required infrastructure is not deployed.');
    console.log('   Please deploy all required infrastructure before seeding.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
