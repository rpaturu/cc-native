#!/usr/bin/env ts-node
/**
 * Seed Methodology Data
 * 
 * Loads baseline methodology bundles into Schema Registry and Methodology table.
 * 
 * Usage:
 *   npm run seed:methodologies [--tenant-id tenant:global] [--region us-west-2]
 * 
 * Environment variables (from .env file):
 *   - METHODOLOGY_TABLE_NAME
 *   - SCHEMA_REGISTRY_BUCKET
 *   - SCHEMA_REGISTRY_TABLE_NAME
 *   - CRITICAL_FIELD_REGISTRY_TABLE_NAME
 *   - AWS_REGION
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { MethodologyService } from '../services/methodology/MethodologyService';
import { SchemaRegistryService } from '../services/world-model/SchemaRegistryService';
import { Logger } from '../services/core/Logger';
import { CreateMethodologyInput } from '../types/MethodologyTypes';

// Load environment variables from .env file if it exists
if (fs.existsSync(path.join(__dirname, '../../.env'))) {
  dotenv.config({ path: path.join(__dirname, '../../.env') });
}

const METHODOLOGY_FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/methodology');

interface SeedOptions {
  tenantId?: string;
  region?: string;
  methodologyTableName: string;
  schemaBucket: string;
  schemaRegistryTableName: string;
  criticalFieldsTableName: string;
}

/**
 * Load methodology from fixture file
 */
function loadMethodologyFixture(filename: string): any {
  const filePath = path.join(METHODOLOGY_FIXTURES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Methodology fixture not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Seed baseline methodologies
 */
async function seedMethodologies(options: SeedOptions): Promise<void> {
  // Load baseline methodologies
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

  console.log(`🌱 Seeding ${methodologies.length} methodologies for tenant: ${options.tenantId || 'tenant:global'}`);
  
  const logger = new Logger('SeedMethodologies');
  
  const schemaRegistryService = new SchemaRegistryService(
    logger,
    options.schemaBucket,
    options.schemaRegistryTableName,
    options.criticalFieldsTableName,
    options.region
  );

  const methodologyService = new MethodologyService(
    logger,
    schemaRegistryService,
    options.methodologyTableName,
    options.schemaBucket,
    options.region
  );

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const methodology of methodologies) {
    try {
      // Create methodology input (version is generated internally, so we don't pass it)
      const input: CreateMethodologyInput = {
        methodology_id: methodology.methodology_id,
        name: methodology.name,
        description: methodology.description,
        dimensions: methodology.dimensions,
        scoring_model: methodology.scoring_model,
        autonomy_gates: methodology.autonomy_gates,
        tenant_id: methodology.tenant_id || options.tenantId || 'tenant:global',
      };

      const created = await methodologyService.createMethodology(input);

      console.log(`✅ Seeded: ${created.methodology_id} (version: ${created.version})`);
      successCount++;
    } catch (error: any) {
      // Check if it's a conditional check failure (already exists)
      if (error.name === 'ConditionalCheckFailedException' || 
          (error instanceof Error && error.message.includes('already exists')) ||
          (error instanceof Error && error.message.includes('ConditionalCheckFailedException'))) {
        console.log(`⏭️  Skipped (already exists): ${methodology.methodology_id}`);
        skipCount++;
      } else {
        console.error(`❌ Failed to seed ${methodology.methodology_id}:`, error instanceof Error ? error.message : String(error));
        errorCount++;
        // Continue with other methodologies even if one fails
      }
    }
  }

  console.log('\n📊 Seeding Summary:');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skipCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  
  if (errorCount > 0) {
    throw new Error(`Failed to seed ${errorCount} methodology(ies)`);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Get required environment variables
  const methodologyTableName = process.env.METHODOLOGY_TABLE_NAME;
  const schemaBucket = process.env.SCHEMA_REGISTRY_BUCKET;
  const schemaRegistryTableName = process.env.SCHEMA_REGISTRY_TABLE_NAME;
  const criticalFieldsTableName = process.env.CRITICAL_FIELD_REGISTRY_TABLE_NAME;
  const region = process.env.AWS_REGION || 'us-west-2';

  // Validate required environment variables
  if (!methodologyTableName) {
    console.error('❌ Error: METHODOLOGY_TABLE_NAME environment variable is required');
    console.error('   Please ensure .env file exists with table names from CDK outputs');
    process.exit(1);
  }
  if (!schemaBucket) {
    console.error('❌ Error: SCHEMA_REGISTRY_BUCKET environment variable is required');
    process.exit(1);
  }
  if (!schemaRegistryTableName) {
    console.error('❌ Error: SCHEMA_REGISTRY_TABLE_NAME environment variable is required');
    process.exit(1);
  }
  if (!criticalFieldsTableName) {
    console.error('❌ Error: CRITICAL_FIELD_REGISTRY_TABLE_NAME environment variable is required');
    process.exit(1);
  }

  const options: SeedOptions = {
    tenantId: 'tenant:global',
    region,
    methodologyTableName,
    schemaBucket,
    schemaRegistryTableName,
    criticalFieldsTableName,
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tenant-id' && i + 1 < args.length) {
      options.tenantId = args[i + 1];
      i++;
    } else if (args[i] === '--region' && i + 1 < args.length) {
      options.region = args[i + 1];
      i++;
    }
  }

  try {
    await seedMethodologies(options);
    console.log('\n✅ Methodology seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Methodology seeding failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
