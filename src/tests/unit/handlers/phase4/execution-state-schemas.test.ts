/**
 * Phase 4 execution state schemas — coverage for optional preprocess (auto_executed, approval_source).
 * Covers execution-state-schemas.ts lines 19–22 (autoExecutedOptional string coercion).
 * See docs/implementation/phase_4/testing/PHASE_4_COVERAGE_TEST_PLAN.md.
 */

import {
  StartExecutionInputSchema,
  ToolInvocationRequestSchema,
} from '../../../../handlers/phase4/execution-state-schemas';

const baseStartInput = {
  action_intent_id: 'intent-1',
  tenant_id: 't1',
  account_id: 'a1',
};

describe('StartExecutionInputSchema - approval_source and auto_executed preprocess', () => {
  it('parses approval_source empty string as undefined', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      approval_source: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approval_source).toBeUndefined();
    }
  });

  it('parses approval_source null as undefined', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      approval_source: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approval_source).toBeUndefined();
    }
  });

  it('parses approval_source HUMAN as HUMAN', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      approval_source: 'HUMAN',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approval_source).toBe('HUMAN');
    }
  });

  it('parses auto_executed string "true" as true', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      auto_executed: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_executed).toBe(true);
    }
  });

  it('parses auto_executed string "false" as false', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      auto_executed: 'false',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_executed).toBe(false);
    }
  });

  it('parses auto_executed empty string as undefined', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      auto_executed: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_executed).toBeUndefined();
    }
  });

  it('parses auto_executed null as undefined', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      auto_executed: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_executed).toBeUndefined();
    }
  });

  it('parses auto_executed boolean true as true', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      auto_executed: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_executed).toBe(true);
    }
  });

  it('parses auto_executed boolean false as false', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      auto_executed: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_executed).toBe(false);
    }
  });

  it('parses auto_executed invalid string as undefined (preprocess returns undefined, optional accepts)', () => {
    const result = StartExecutionInputSchema.safeParse({
      ...baseStartInput,
      auto_executed: 'maybe',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_executed).toBeUndefined();
    }
  });
});

describe('ToolInvocationRequestSchema - tool_arguments refinements', () => {
  const baseToolInput = {
    gateway_url: 'https://gateway.example.com',
    tool_name: 'test_tool',
    tool_arguments: {},
    idempotency_key: 'key-1',
    action_intent_id: 'intent-1',
    tenant_id: 't1',
    account_id: 'a1',
    trace_id: 'trace-1',
  };

  it('rejects tool_arguments null', () => {
    const result = ToolInvocationRequestSchema.safeParse({
      ...baseToolInput,
      tool_arguments: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects tool_arguments array', () => {
    const result = ToolInvocationRequestSchema.safeParse({
      ...baseToolInput,
      tool_arguments: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects tool_arguments exceeding 200KB', () => {
    const big = { x: 'y'.repeat(200 * 1024) };
    const result = ToolInvocationRequestSchema.safeParse({
      ...baseToolInput,
      tool_arguments: big,
    });
    expect(result.success).toBe(false);
  });

  it('accepts tool_arguments plain object under 200KB', () => {
    const result = ToolInvocationRequestSchema.safeParse(baseToolInput);
    expect(result.success).toBe(true);
  });
});
