/**
 * Jest Setup File
 * 
 * Loads environment variables and configures AWS SDK for tests.
 * This runs before all tests.
 */

// Load .env.local first (local overrides), then .env (deployment config)
try {
  const dotenv = require('dotenv');
  const path = require('path');
  const fs = require('fs');
  
  // Load .env.local if it exists (local overrides)
  const envLocalPath = path.join(__dirname, '../../../.env.local');
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
    console.log('✓ Loaded .env.local');
  }
  
  // Load .env if it exists (deployment config)
  const envPath = path.join(__dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('✓ Loaded .env');
  }
} catch (error) {
  // dotenv not available, continue
  console.warn('dotenv not available, using process.env directly');
}

// Configure AWS SDK to use environment variables for credentials
// Set AWS_SDK_LOAD_CONFIG to ensure credentials are loaded from environment
process.env.AWS_SDK_LOAD_CONFIG = '1';

// If credentials are in environment variables, AWS SDK will use them automatically
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  console.log('✓ AWS credentials found in environment variables');
} else if (process.env.AWS_PROFILE) {
  console.log(`✓ Using AWS profile: ${process.env.AWS_PROFILE}`);
} else {
  // Try to use default credential chain (~/.aws/credentials)
  console.warn('⚠ No AWS credentials found in environment. Using default credential chain.');
  console.warn('  Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE in .env.local');
}

// Mock AWS SDK credential provider to avoid dynamic import issues
// This prevents ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG error
jest.mock('@aws-sdk/credential-provider-node', () => {
  const originalModule = jest.requireActual('@aws-sdk/credential-provider-node');
  
  // Return a mock that uses static credentials from environment
  return {
    ...originalModule,
    defaultProvider: jest.fn(() => {
      // Return a promise that resolves to static credentials
      return Promise.resolve({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test-key',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test-secret',
        sessionToken: process.env.AWS_SESSION_TOKEN,
      });
    }),
  };
});
