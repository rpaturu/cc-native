import { Timestamped, TenantScoped } from './CommonTypes';

/**
 * User identity
 */
export interface UserIdentity extends Timestamped, TenantScoped {
  userId: string;
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  permissions: IdentityPermissions;
  cognitoUserId?: string; // Cognito sub/username
  status: IdentityStatus;
}

/**
 * Agent identity
 */
export interface AgentIdentity extends Timestamped, TenantScoped {
  agentId: string;
  name: string;
  description?: string;
  agentType: AgentType;
  permissions: IdentityPermissions;
  iamRoleArn?: string; // IAM role ARN for agent
  status: IdentityStatus;
  capabilities: AgentCapability[];
}

/**
 * Agent type
 */
export type AgentType = 
  | 'AUTONOMOUS_DECISION'  // Full autonomous decision agent
  | 'TOOL_EXECUTOR'        // Tool execution agent
  | 'PERCEPTION'           // Perception/signal generation agent
  | 'VALIDATION'           // Validation agent
  | 'CUSTOM';              // Custom agent type

/**
 * Agent capabilities
 */
export interface AgentCapability {
  capability: string; // e.g., 'read_world_state', 'execute_tools', 'generate_signals'
  allowed: boolean;
  constraints?: {
    maxAutonomyTier?: 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';
    requiresApproval?: boolean;
    rateLimit?: {
      requestsPerMinute: number;
      burst: number;
    };
  };
}

/**
 * Identity permissions
 */
export interface IdentityPermissions {
  canReadWorldState: boolean;
  canReadEvidence: boolean;
  canReadSnapshots: boolean;
  canExecuteTools: boolean;
  canCreateActions: boolean;
  canApproveActions: boolean;
  allowedTenants?: string[]; // If empty, access to all tenants (admin)
  maxAutonomyTier?: 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';
}

/**
 * Identity status
 */
export type IdentityStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

/**
 * Identity service interface
 */
export interface IIdentityService {
  getUserIdentity(userId: string, tenantId: string): Promise<UserIdentity | null>;
  getAgentIdentity(agentId: string, tenantId: string): Promise<AgentIdentity | null>;
  validateUserIdentity(userId: string, tenantId: string): Promise<boolean>;
  validateAgentIdentity(agentId: string, tenantId: string): Promise<boolean>;
  getUserPermissions(userId: string, tenantId: string): Promise<IdentityPermissions | null>;
  getAgentPermissions(agentId: string, tenantId: string): Promise<IdentityPermissions | null>;
  createUserIdentity(input: CreateUserIdentityInput): Promise<UserIdentity>;
  createAgentIdentity(input: CreateAgentIdentityInput): Promise<AgentIdentity>;
  updateUserIdentity(userId: string, tenantId: string, updates: UpdateUserIdentityInput): Promise<UserIdentity>;
  updateAgentIdentity(agentId: string, tenantId: string, updates: UpdateAgentIdentityInput): Promise<AgentIdentity>;
}

/**
 * Create user identity input
 */
export interface CreateUserIdentityInput {
  userId: string;
  tenantId: string;
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  permissions?: Partial<IdentityPermissions>;
  cognitoUserId?: string;
}

/**
 * Create agent identity input
 */
export interface CreateAgentIdentityInput {
  agentId: string;
  tenantId: string;
  name: string;
  description?: string;
  agentType: AgentType;
  permissions?: Partial<IdentityPermissions>;
  iamRoleArn?: string;
  capabilities: AgentCapability[];
}

/**
 * Update user identity input
 */
export interface UpdateUserIdentityInput {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  permissions?: Partial<IdentityPermissions>;
  status?: IdentityStatus;
}

/**
 * Update agent identity input
 */
export interface UpdateAgentIdentityInput {
  name?: string;
  description?: string;
  permissions?: Partial<IdentityPermissions>;
  status?: IdentityStatus;
  capabilities?: AgentCapability[];
}
