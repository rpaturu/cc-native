# End-State AWS Architecture

## AI-Native Autonomous Revenue Decision Loop (AgentCore-Native)

---

## Architectural Principle

This system is designed as a **decision-first, autonomy-with-governance platform**.

Large Language Models **do not execute freely**.
They **deliberate**, **propose**, and **request tools** through a controlled plane.

Amazon **Bedrock AgentCore** provides the **agent runtime, tool gateway, and identity fabric**, while the system's **policy engine, world model, and trust ledger** enforce enterprise-grade control.

---

## 1) Identity, Tenancy, and Governance

**Purpose:** enforce tenant isolation, secure tool access, and auditable autonomy.

### Services

* **Amazon Cognito / IAM Identity Center**
  User authentication, enterprise SSO, SCIM provisioning
* **Amazon Bedrock AgentCore Identity**
  Secure, managed identity for agents and tool invocation
  Handles OAuth flows and tool-level authorization
* **AWS Organizations + SCPs**
  Account-level guardrails if required
* **AWS KMS**
  Per-tenant encryption keys
* **AWS Audit Manager**
  Compliance evidence and reporting

**Outcome:**
Human users and autonomous agents operate under **explicit, auditable identities**.

---

## 2) Inputs & Connector Fabric (Push + Pull)

**Purpose:** ingest raw operational data reliably, cost-efficiently, and with backpressure.

### Inbound (push)

* **API Gateway** – webhook ingress
* **EventBridge** – routing, partner events
* **SQS** – buffering and throttling
* **Lambda** – lightweight webhook handlers

### Outbound / Polling (pull)

* **EventBridge Scheduler** – polling cadence
* **Step Functions** – connector workflows, retries, idempotency
* **ECS/Fargate** – long-running or heavy connectors
* **Secrets Manager** – credential storage and rotation
* **PrivateLink / VPC Endpoints** – private SaaS connectivity

**Outcome:**
Connectors are **resilient, throttled, observable**, and isolated from agent logic.

---

## 3) Perception Layer

### Normalize → Resolve → Diff → Signal

**Purpose:** convert raw data into **canonical signals** the system can reason over.

### Services

* **Step Functions** – perception orchestration
* **Lambda / ECS** – normalization, enrichment, diffing
* **Glue** – batch transforms, schema evolution
* **DynamoDB** – cursors, hashes, heat scores, entity index
* **S3** – immutable raw snapshots
* **Kinesis Data Streams** – high-volume signal streams (optional)
* **Neptune** – entity resolution graph (optional)

**Outcome:**
The system observes **change**, not noise.
Outputs are **Signals**, not events.

---

## 4) World Model & Memory

**Purpose:** maintain a continuously updated representation of account reality.

### Situation Graph

* **Amazon Neptune**
  Accounts ↔ Contacts ↔ Opportunities ↔ Products ↔ Risks ↔ Events

### Memory & Retrieval

* **S3** – artifacts (briefs, summaries, extracted docs)
* **Pinecone** – semantic retrieval (vector memory)
* **Aurora PostgreSQL** (optional) – transactional joins when required

> AgentCore Memory may be used for agent-local context, but **Neptune + S3 remain the canonical enterprise memory**.

**Outcome:**
A **living account model** that compounds knowledge over time.

---

## 5) Decision Layer (AgentCore-Native)

**Purpose:** deliberate, decide, and request actions under governance.

### Agent Runtime & LLM

* **Amazon Bedrock** – foundation models
* **Bedrock Guardrails** – safety, PII, policy filters
* **Amazon Bedrock AgentCore Runtime**
  Hosts the autonomous decision agent (framework-agnostic)

### Decision Service

* Agent implements:

  * decision taxonomy
  * action proposals
  * uncertainty detection
  * stop conditions
* Outputs **structured proposals**, not free text

**Outcome:**
LLMs are **decision engines**, not workflow engines.

---

## 6) Tool Plane (AgentCore Gateway)

**Purpose:** controlled, auditable access to tools and actions.

### Services

* **Amazon Bedrock AgentCore Gateway**

  * Unified MCP endpoint
  * Exposes:

    * Lambda functions
    * OpenAPI services
    * MCP servers
  * Supports:

    * tool discovery
    * tool invocation
    * centralized auth via AgentCore Identity

### Tool Examples

* `crm.get_commercial_window`
* `signals.list_recent`
* `telemetry.get_health_summary`
* `memory.search`
* `draft.meeting_brief`
* `crm.write_update`

**Outcome:**
Agents **request tools**; the platform **decides what runs**.

---

## 7) Policy & Governance Layer

**Purpose:** enforce deterministic safety and cost control.

### Services

* **OPA on ECS** *or* **Lambda policy engine**
* **DynamoDB** – policies, permissions, thresholds
* **AppConfig** – feature flags, kill switches, rollout control

### Responsibilities

* Autonomy classification (safe / approval required)
* Cost and budget enforcement
* Permission checks
* Tenant-specific constraints

**Outcome:**
Autonomy is **bounded, explicit, and reversible**.

---

## 8) Action Execution & Human Touch

**Purpose:** execute approved actions and route human-touch decisions.

### Execution

* **Step Functions** – multi-step orchestration, compensation
* **Lambda / ECS** – action executors
* **SQS** – per-connector throttling

### Human Interaction

* **CloudFront + S3 / Amplify** – Approval UI
* **API Gateway + Lambda** – approval APIs
* **DynamoDB** – ApprovalRequests, ActionQueue
* **SNS / Slack / Email** – notifications

**Outcome:**
The system acts autonomously **until human judgment is required**.

---

## 9) Trust, Audit, and Learning

**Purpose:** make every decision provable and improve over time.

### Audit & Ledger

* **Amazon QLDB** – tamper-evident execution ledger
* **S3 Object Lock (WORM)** – immutable archives
* **DynamoDB** – hot index for UI queries

### Validation

* Deterministic validators (Lambda/ECS)
* Optional bounded LLM rubric checks (logged)

### Observability

* **CloudWatch Logs & Metrics**
* **X-Ray**
* **OpenTelemetry (ECS)**

### Learning Loop

* **Glue + Athena** – outcome analysis
* **SageMaker** – ranking, calibration, evaluation
* **Feature Store** – learned weights and thresholds

**Outcome:**
Trust is **architectural**, not promised.
Learning compounds without breaking policy.

---

## Architectural Summary (Investor-Grade)

* **AgentCore Gateway** is the **tool and execution plane**
* **AgentCore Runtime** hosts decision agents
* **Policy, memory, and trust remain first-class system primitives**
* Existing revenue systems are **activated**, not replaced
* Humans supervise decisions, not workflows

---

## One-Line Positioning

> **This architecture introduces an autonomous decision and execution layer for revenue—governed by policy, grounded in evidence, and supervised by humans only where judgment is required.**

---
