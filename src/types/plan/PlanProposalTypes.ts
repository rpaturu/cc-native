/**
 * Phase 6.2 — Plan proposal input/output (DRAFT only; cannot auto-approve).
 * See PHASE_6_2_CODE_LEVEL_PLAN.md §3.
 */

import { PlanType } from './PlanTypeConfig';
import { RevenuePlanV1 } from './PlanTypes';

export interface PlanProposalInput {
  tenant_id: string;
  account_id: string;
  plan_type: PlanType;
  posture?: Record<string, unknown>;
  signals?: unknown[];
  history?: unknown[];
  tenant_goals?: Record<string, unknown>;
}

export interface PlanProposalOutput {
  plan: RevenuePlanV1;
  proposal_id?: string;
}
