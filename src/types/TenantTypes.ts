import { Timestamped } from './CommonTypes';

/**
 * Tenant configuration
 */
export interface TenantConfig {
  name: string;
  region?: string;
  timezone?: string;
  features?: Record<string, boolean>;
  limits?: {
    maxAccounts?: number;
    maxUsers?: number;
    maxAgents?: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Tenant status
 */
export type TenantStatus = 'active' | 'suspended' | 'deleted';

/**
 * Tenant model
 */
export interface Tenant extends Timestamped {
  tenantId: string;
  name: string;
  status: TenantStatus;
  config: TenantConfig;
  metadata?: Record<string, any>;
}

/**
 * Tenant creation input
 */
export interface CreateTenantInput {
  tenantId: string;
  name: string;
  config?: Partial<TenantConfig>;
  metadata?: Record<string, any>;
}

/**
 * Tenant update input
 */
export interface UpdateTenantInput {
  name?: string;
  status?: TenantStatus;
  config?: Partial<TenantConfig>;
  metadata?: Record<string, any>;
}
