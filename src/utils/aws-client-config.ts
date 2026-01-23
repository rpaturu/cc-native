/**
 * AWS Client Configuration Helper
 * 
 * Creates AWS SDK client configuration with credentials from environment variables.
 * This avoids dynamic import issues in Jest by using static credentials.
 */

export interface AWSClientConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

/**
 * Get AWS client configuration with credentials from environment
 * 
 * This prevents the AWS SDK credential provider from using dynamic imports,
 * which causes issues in Jest. Uses plain credentials object to bypass provider chain.
 */
export function getAWSClientConfig(region?: string): any {
  const config: any = { region };
  
  // Use static credentials from environment if available
  // Pass credentials directly as plain object to avoid credential provider chain
  // which uses dynamic imports
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    };
  }
  
  return config;
}
