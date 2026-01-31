/**
 * Load .env for integration tests (shared by all integration suites).
 */

export function loadEnv(): void {
  try {
    require('dotenv').config({ path: '.env.local' });
    require('dotenv').config({ path: '.env' });
  } catch {
    // dotenv not available
  }
}
