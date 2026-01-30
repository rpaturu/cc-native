# Autonomous Revenue Decision Loop

AI-native autonomous revenue system that continuously converts information into action, involving humans only when actions touch people or uncertainty is high.

## Architecture

This system is a **policy-governed autonomous decision loop** built on AWS with Amazon Bedrock AgentCore as the agent runtime and tool gateway.

### Key Components

- **Perception Layer**: Converts raw data into canonical signals
- **World Model**: Maintains a living Situation Graph (Neptune) and semantic memory (Pinecone)
- **Decision Layer**: AgentCore-native decision agent that proposes actions
- **Tool Plane**: AgentCore Gateway for controlled tool access
- **Policy & Governance**: Enforces safety, cost control, and autonomy boundaries
- **Action Execution**: Executes approved actions with human touch routing
- **Trust & Audit**: QLDB ledger for tamper-evident execution history

## Project Structure

```
cc-native/
├── docs/                    # Strategy and documentation
│   ├── README.md
│   └── strategy/           # Strategic planning documents
├── src/                     # Application source code
│   ├── services/
│   │   ├── core/           # Core services (Logger, Cache, etc.)
│   │   ├── perception/     # Signal generation and normalization
│   │   ├── memory/         # World model and retrieval
│   │   ├── decision/       # Decision agent implementation
│   │   ├── tools/          # Tool implementations
│   │   ├── policy/         # Policy engine
│   │   └── handlers/      # Lambda and Step Functions handlers
│   └── types/              # TypeScript type definitions
├── infrastructure/          # AWS CDK infrastructure
│   └── bin/
│       └── infrastructure.ts
└── package.json
```

## Implementation Phases

See `docs/strategy/IMPLEMENTATION_APPROACH.md` for detailed phased implementation plan:

- **Phase 0**: Foundations (identity, event spine, storage, audit) ✅ **Complete**
- **Phase 1**: Perception V1 (signals without data-lake pain) ✅ **Complete**
- **Phase 2**: World Model (Situation Graph + retrieval plane) ✅ **Complete**
- **Phase 3**: Autonomous Decision + Action Proposal (Human-in-the-Loop) ✅ **Complete**
  - Decision synthesis with LLM (Bedrock)
  - Policy gate for deterministic action evaluation
  - Human approval routing
  - Decision audit and explainability
- **Phase 4**: Action Execution (bounded execution, connector write-backs) — 4.1–4.4 complete; 4.5A (testing & polish) in progress. Execution flow: EventBridge (ACTION_APPROVED) → Step Functions → Tool Mapper → AgentCore Gateway → Connector Adapters (e.g. Internal Adapter) → Tool Invoker → Execution Recorder (outcome + signals). Status API and E2E script available. See `docs/implementation/phase_4/PHASE_4_5_CODE_LEVEL_PLAN.md` for sign-off gate and `docs/implementation/phase_4/PHASE_4_ARCHITECTURE.md` for architecture.
- **Phase 5**: Enhanced Tool Plane (AgentCore Gateway)
- **Phase 6**: Trust, Quality, and Cost Controls

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- AWS CLI configured
- AWS CDK CLI installed (`npm install -g aws-cdk`)

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Deploy

Use the project deploy script (builds and deploys; writes stack outputs to `.env`):

```bash
./deploy
```

After deploy, `.env` contains table names, event bus name, and API URLs required for tests and E2E.

### Running tests

- **Unit tests:** `npm test` (or `npm test -- --testPathPattern="phase4|execution"` for Phase 4 only).
- **Integration tests:** Require deployed stack and `.env` from deploy. See `docs/implementation/phase_4/TESTING.md` for commands and links to per-phase test plans.
- **Phase 4 E2E (one deterministic path):** If the stack is already deployed, ensure `.env` is populated (e.g. from a prior `./deploy` or re-run `./deploy` to refresh). Then run `./scripts/phase_4/test-phase4-execution.sh`. It loads `.env`, seeds an action intent, puts ACTION_APPROVED to EventBridge, waits for execution, and verifies via DynamoDB (or Execution Status API if configured). Prerequisites: AWS CLI v2, jq; all required vars must be set (no fallbacks outside dev). See `docs/implementation/phase_4/PHASE_4_5_CODE_LEVEL_PLAN.md` §3.

## Documentation

- [Autonomous Revenue Decision Loop](./docs/strategy/AUTONOMOUS_REVENUE_DECISION_LOOP.md) - Core architecture
- [AWS Architecture](./docs/strategy/AWS_ARCHITECTURE.md) - Infrastructure design
- [Implementation Approach](./docs/strategy/IMPLEMENTATION_APPROACH.md) - Phased implementation plan
- [Deal Lifecycle Action Map](./docs/strategy/DEAL_LIFECYCLE_ACTION_MAP.md) - Action classes across lifecycle
- [Life of Sales Development](./docs/strategy/LIFE_OF_SALES_DEVELOPMENT.md) - User experience narrative
- [Day in Life Comparison](./docs/strategy/DAY_IN_LIFE_COMPARISON.md) - Before/after comparison

## License

MIT
