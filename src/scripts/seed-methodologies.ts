#!/usr/bin/env ts-node
/**
 * Seed Methodology Data
 * 
 * Loads baseline methodology bundles into Schema Registry and Methodology table.
 * 
 * NOTE: This script requires MethodologyService to be implemented first.
 * It's a placeholder for future implementation.
 * 
 * Usage (when implemented):
 *   ts-node src/scripts/seed-methodologies.ts [--tenant-id tenant:global] [--region us-west-2]
 */

import * as fs from 'fs';
import * as path from 'path';

// TODO: Uncomment when MethodologyService is implemented
// import { MethodologyService } from '../services/methodology/MethodologyService';
// import { SchemaRegistryService } from '../services/world-model/SchemaRegistryService';
// import { Logger } from '../services/core/Logger';
// import { SalesMethodology } from '../types/MethodologyTypes';

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
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Seed baseline methodologies
 * 
 * TODO: Implement when MethodologyService is available
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

  console.log('Methodology seeding not yet implemented.');
  console.log('This script requires MethodologyService to be implemented first.');
  console.log(`Would seed ${methodologies.length} methodologies for tenant: ${options.tenantId || 'tenant:global'}`);
  
  // TODO: Uncomment when MethodologyService is implemented
  /*
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

  for (const methodology of methodologies) {
    try {
      const created = await methodologyService.createMethodology({
        methodology_id: methodology.methodology_id,
        name: methodology.name,
        description: methodology.description,
        dimensions: methodology.dimensions,
        scoring_model: methodology.scoring_model,
        autonomy_gates: methodology.autonomy_gates,
        tenant_id: methodology.tenant_id,
        version: methodology.version,
      });

      logger.info('Methodology seeded', {
        methodology_id: created.methodology_id,
        version: created.version,
        schema_hash: created.schema_hash,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        logger.warn('Methodology already exists, skipping', {
          methodology_id: methodology.methodology_id,
          version: methodology.version,
        });
      } else {
        logger.error('Failed to seed methodology', {
          methodology_id: methodology.methodology_id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }
  */
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const options: SeedOptions = {
    tenantId: 'tenant:global',
    region: process.env.AWS_REGION || 'us-west-2',
    methodologyTableName: process.env.METHODOLOGY_TABLE_NAME || 'cc-native-methodology',
    schemaBucket: process.env.SCHEMA_REGISTRY_BUCKET || 'cc-native-schema-registry',
    schemaRegistryTableName: process.env.SCHEMA_REGISTRY_TABLE_NAME || 'cc-native-schema-registry',
    criticalFieldsTableName: process.env.CRITICAL_FIELD_REGISTRY_TABLE_NAME || 'cc-native-critical-field-registry',
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
    console.log('✅ Methodology seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Methodology seeding failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
