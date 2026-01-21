# Strategy Documentation

This folder contains the strategic planning documents for the AI Sales Assistant evolution from M1 to M2+.

## Documents

### [persona-schema-strategy.md](./persona-schema-strategy.md)
**Purpose**: Defines the persona-specific JSON schema approach for AE, CSM, and SE roles  
**Key Content**: 
- Schema differentiations by sales persona
- Data source requirements by role
- Pricing strategy implications
- LLM prompt weighting strategies

### [vendor-first-differentiation-strategy.md](./vendor-first-differentiation-strategy.md)  
**Purpose**: Market differentiation strategy focusing on vendor-context-first approach  
**Key Content**:
- Competitive analysis vs traditional research vendors (ZoomInfo, Apollo)
- Vendor-context-first value proposition
- Market research content integration strategy
- Go-to-market roadmap and success metrics

### [AUTONOMOUS_REVENUE_DECISION_LOOP.md](./AUTONOMOUS_REVENUE_DECISION_LOOP.md)
**Purpose**: Defines the AI-native autonomous revenue system architecture  
**Key Content**:
- Policy-governed autonomous decision loop (not a workflow engine)
- Situation Graph (world model) for synthesized understanding
- Action Proposal Model with risk classification
- Action classes and autonomy rules
- Human escalation patterns (only when needed)
- Learning and adaptation within guardrails
- Meeting Prep Agent as first instance

### [m2-implementation-roadmap.md](./m2-implementation-roadmap.md)
**Purpose**: Strategic implementation roadmap for M2 vendor-context-first evolution  
**Key Content**:
- Four-phase implementation sequence (Foundation → Intelligence → Integration → Scale)
- Technical and business success metrics
- Competitive moats development strategy
- Immediate next actions and success criteria

## Related Artifacts

### Schemas
- `schemas/ae-deep-dive-schema.json` - Account Executive focused schema
- `schemas/csm-deep-dive-schema.json` - Customer Success Manager focused schema  
- `schemas/se-deep-dive-schema.json` - Solutions Engineer focused schema
- `schemas/vendor-context-first-schema.json` - **Primary schema** with vendor context at core

## Strategic Direction Summary

**M2 Evolution Goal**: Transform from generic company research tool to vendor-specific sales intelligence platform

**Key Differentiator**: Vendor-context-first approach that answers:
- "Should MY company target this customer?"
- "Which of MY products fit their needs?"
- "How do I compete against THEIR current vendor?"
- "What's MY best positioning strategy?"

**Business Model**: Multi-vendor SaaS platform with persona-aware pricing tiers

**Next Implementation Priority**: **Phase 1 - Vendor Configuration System** (Option A)
- Design vendor configuration JSON schema
- Build 3-5 initial vendor configurations (Okta, Microsoft, Ping)  
- Implement vendor selection in user onboarding
- Test vendor-context injection in prototype

---
*Last Updated: M2 Strategy Planning Phase*
