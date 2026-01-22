import { TrustClass } from './CommonTypes';
import { EntityType } from './WorldStateTypes';

/**
 * Field definition in schema
 */
export interface FieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required: boolean;
  critical: boolean;          // Required for Tier A/B autonomy
  description?: string;
  minConfidence?: number;     // Minimum confidence required (0-1)
  maxContradiction?: number;  // Maximum contradiction allowed (0-1)
  ttl?: number;              // Time-to-live in hours
  provenanceCaps?: TrustClass[]; // Allowed provenance trust classes
  examples?: any[];
}

/**
 * Entity schema
 */
export interface EntitySchema {
  entityType: EntityType;
  version: string;
  schemaHash: string;        // SHA-256 hash of schema JSON
  fields: Record<string, FieldDefinition>;
  criticalFields: string[];  // Field names that are critical
  createdAt: string;
  createdBy: string;
  description?: string;
}

/**
 * Critical field registry entry
 */
export interface CriticalFieldRegistry {
  entityType: EntityType;
  fieldName: string;
  required: boolean;
  minConfidence?: number;
  maxContradiction?: number;
  ttl?: number;
  provenanceCaps?: TrustClass[];
  version: string;
  updatedAt: string;
}

/**
 * Schema query filters
 */
export interface SchemaQuery {
  entityType: EntityType;
  version?: string;
}

/**
 * Schema registry service interface
 */
export interface ISchemaRegistryService {
  getSchema(entityType: EntityType, version: string): Promise<EntitySchema | null>;
  getCriticalFields(entityType: EntityType): Promise<CriticalFieldRegistry[]>;
  validateEntityState(entityState: any, entityType: EntityType, version: string): Promise<boolean>;
}
