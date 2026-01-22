import { Traceable, TenantScoped, EvidenceRef } from './CommonTypes';

/**
 * Ledger event types with clear taxonomy:
 * - INTENT = Inbound user/agent request
 * - SIGNAL = Perception output (signal generation)
 * - TOOL_CALL = Tool invocation (request/response)
 * - VALIDATION = Checks/gates (policy, confidence, compliance)
 * - DECISION = Planner output (proposed action set + snapshot binding)
 * - ACTION = Execution attempt/result
 * - APPROVAL = Human-in-the-loop approval/rejection
 */
export enum LedgerEventType {
  INTENT = 'INTENT',
  SIGNAL = 'SIGNAL',
  TOOL_CALL = 'TOOL_CALL',
  VALIDATION = 'VALIDATION',
  DECISION = 'DECISION',
  ACTION = 'ACTION',
  APPROVAL = 'APPROVAL',
}

/**
 * Ledger entry
 */
export interface LedgerEntry extends Traceable, TenantScoped {
  entryId: string;
  eventType: LedgerEventType;
  timestamp: string;
  data: Record<string, any>;
  evidenceRefs?: EvidenceRef[];
  previousEntryId?: string; // For chain of custody
  snapshotId?: string; // Required for DECISION and ACTION events
  accountId?: string;
  userId?: string;
  agentId?: string;
}

/**
 * Ledger query filters
 */
export interface LedgerQuery {
  tenantId: string;
  traceId?: string;
  eventType?: LedgerEventType;
  startTime?: string;
  endTime?: string;
  accountId?: string;
  limit?: number;
}

/**
 * Ledger service interface
 */
export interface ILedgerService {
  append(entry: Omit<LedgerEntry, 'entryId' | 'timestamp'>): Promise<LedgerEntry>;
  query(query: LedgerQuery): Promise<LedgerEntry[]>;
  getByTraceId(traceId: string): Promise<LedgerEntry[]>;
  getByEntryId(entryId: string): Promise<LedgerEntry | null>;
}
