# Scripts Directory

This directory contains utility scripts organized by implementation phase.

## Directory Structure

```
scripts/
├── common/           # Shared scripts used across multiple phases
├── phase_2/         # Phase 2 specific scripts
├── phase_3/         # Phase 3 specific scripts
├── delete-retained-resources.sh   # Delete retained resources after ./destroy
└── README.md        # This file
```

## Scripts by Phase

### Stack / Infra (repo root `scripts/`)

**`delete-retained-resources.sh`**
- Deletes CCNativeStack resources retained or left behind after `./destroy`: S3 buckets (evidence-ledger, world-state-snapshots, schema-registry, artifacts, ledger-archives) and **all** cc-native DynamoDB tables (37 tables: root, Decision, Execution, Autonomy, Graph, Scheduling, Perception).
- Run from repo root after destroy when you need a clean state before `./deploy`.
- Usage: `./scripts/delete-retained-resources.sh [--profile PROFILE] [--region REGION] [--force]`

### Common Scripts (`common/`)

**`setup-test-runner-prerequisites.sh`**
- Sets up prerequisites for running integration tests on EC2
- Creates security groups, IAM roles, instance profiles
- Used by Phase 2 and Phase 3 testing

**`manage-test-runner-instance.sh`**
- Manages EC2 test runner instance lifecycle
- Launch, connect, run tests, destroy instance
- Used by Phase 2 integration tests

**`run-tests-on-instance.sh`**
- Runs tests on an existing EC2 instance
- Supports Phase 2 integration tests
- Can be extended for other phases

### Phase 2 Scripts (`phase_2/`)

**`run-phase2-integration-tests.sh`**
- Complete workflow for Phase 2 integration tests
- Sets up instance, runs tests, tears down
- Tests graph materialization and synthesis

### Phase 3 Scripts (`phase_3/`)

**`test-phase3-api.sh`**
- Tests Phase 3 Decision API endpoints
- Verifies Bedrock VPC endpoint connectivity
- Checks budget reset scheduler
- Quick validation script for Phase 3 deployment

## Usage

### Running Phase 2 Integration Tests

```bash
# Complete workflow (setup, test, teardown)
./scripts/phase_2/run-phase2-integration-tests.sh

# Or use common scripts directly
./scripts/common/setup-test-runner-prerequisites.sh
./scripts/common/manage-test-runner-instance.sh launch
./scripts/common/run-tests-on-instance.sh run-tests
```

### Running Phase 3 API Tests

```bash
# Quick API endpoint testing
./scripts/phase_3/test-phase3-api.sh
```

### Setting Up Test Runner

```bash
# One-time setup (creates IAM role, security groups, etc.)
./scripts/common/setup-test-runner-prerequisites.sh
```

## Adding New Scripts

When adding new scripts:

1. **Phase-specific scripts**: Place in `phase_X/` directory
2. **Shared scripts**: Place in `common/` directory
3. **Update this README**: Document the new script's purpose and usage

## Script Conventions

- All scripts should be executable (`chmod +x`)
- Include shebang: `#!/bin/bash`
- Include usage comments at the top
- Use `set -e` for error handling
- Follow consistent naming: `kebab-case.sh`

---

**Last Updated:** 2026-01-25
