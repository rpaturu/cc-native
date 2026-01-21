/**
 * Autonomous Revenue Decision Loop
 * 
 * Main entry point for the application.
 * This file is primarily for local development/testing.
 * 
 * Production execution happens via:
 * - Lambda functions (handlers)
 * - Step Functions (orchestration)
 * - AgentCore Runtime (decision agent)
 */

import { config } from 'dotenv';

// Load environment variables
config();

async function main() {
  try {
    console.log('🚀 Autonomous Revenue Decision Loop');
    console.log('This is a serverless application running on AWS.');
    console.log('See infrastructure/ for CDK deployment configuration.');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {};
