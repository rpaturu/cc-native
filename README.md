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

- **Phase 0**: Foundations (identity, event spine, storage, audit)
- **Phase 1**: Perception V1 (signals without data-lake pain)
- **Phase 2**: World Model (Situation Graph + retrieval plane)
- **Phase 3**: Tool Plane (AgentCore Gateway)
- **Phase 4**: Decision Agent (AgentCore Runtime)
- **Phase 5**: Action Execution + Human Touch UX
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

```bash
npm run deploy
```

## Documentation

- [Autonomous Revenue Decision Loop](./docs/strategy/AUTONOMOUS_REVENUE_DECISION_LOOP.md) - Core architecture
- [AWS Architecture](./docs/strategy/AWS_ARCHITECTURE.md) - Infrastructure design
- [Implementation Approach](./docs/strategy/IMPLEMENTATION_APPROACH.md) - Phased implementation plan
- [Deal Lifecycle Action Map](./docs/strategy/DEAL_LIFECYCLE_ACTION_MAP.md) - Action classes across lifecycle
- [Life of Sales Development](./docs/strategy/LIFE_OF_SALES_DEVELOPMENT.md) - User experience narrative
- [Day in Life Comparison](./docs/strategy/DAY_IN_LIFE_COMPARISON.md) - Before/after comparison

## License

MIT
