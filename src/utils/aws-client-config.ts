/**
 * AWS Client Configuration Helper
 * 
 * Creates AWS SDK client configuration with credentials from environment variables.
 * This avoids dynamic import issues in Jest by using static credentials.
 * 
 * Supports:
 * - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (direct credentials)
 * - AWS_PROFILE (reads from ~/.aws/credentials via ini-loader, no dynamic imports)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AWSClientConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

/**
 * Read AWS credentials from ~/.aws/credentials file
 * This avoids dynamic imports by reading the file directly
 */
function readCredentialsFromProfile(profileName: string): { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string } | null {
  try {
    const credentialsPath = path.join(os.homedir(), '.aws', 'credentials');
    if (!fs.existsSync(credentialsPath)) {
      return null;
    }

    const credentialsContent = fs.readFileSync(credentialsPath, 'utf-8');
    const lines = credentialsContent.split('\n');
    
    let inProfile = false;
    let accessKeyId: string | undefined;
    let secretAccessKey: string | undefined;
    let sessionToken: string | undefined;
    
    // Handle default profile
    const targetProfile = profileName === 'default' ? 'default' : `profile ${profileName}`;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check if we're entering the target profile
      if (trimmed === `[${profileName}]` || (profileName === 'default' && trimmed === '[default]')) {
        inProfile = true;
        continue;
      }
      
      // Check if we're entering a different profile
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        if (inProfile) break; // We've left our profile
        inProfile = false;
        continue;
      }
      
      // Read credentials from current profile
      if (inProfile) {
        if (trimmed.startsWith('aws_access_key_id')) {
          accessKeyId = trimmed.split('=')[1]?.trim();
        } else if (trimmed.startsWith('aws_secret_access_key')) {
          secretAccessKey = trimmed.split('=')[1]?.trim();
        } else if (trimmed.startsWith('aws_session_token')) {
          sessionToken = trimmed.split('=')[1]?.trim();
        }
      }
    }
    
    if (accessKeyId && secretAccessKey) {
      return {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {}),
      };
    }
    
    return null;
  } catch (error) {
    // If we can't read the file, return null
    return null;
  }
}

/**
 * Get AWS client configuration with credentials from environment
 * 
 * This prevents the AWS SDK credential provider from using dynamic imports,
 * which causes issues in Jest. Uses plain credentials object to bypass provider chain.
 * 
 * Priority:
 * 1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (direct credentials)
 * 2. AWS_PROFILE (reads from ~/.aws/credentials)
 * 3. Default credential chain (may use dynamic imports, but only as fallback)
 */
export function getAWSClientConfig(region?: string): any {
  const config: any = { region: region || process.env.AWS_REGION };
  
  // Priority 1: Direct credentials from environment
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    };
    return config;
  }
  
  // Priority 2: Read from AWS_PROFILE (without dynamic imports)
  if (process.env.AWS_PROFILE) {
    const profileCredentials = readCredentialsFromProfile(process.env.AWS_PROFILE);
    if (profileCredentials && profileCredentials.accessKeyId && profileCredentials.secretAccessKey) {
      config.credentials = profileCredentials;
      return config;
    }
  }
  
  // Priority 3: Try default profile
  const defaultCredentials = readCredentialsFromProfile('default');
  if (defaultCredentials && defaultCredentials.accessKeyId && defaultCredentials.secretAccessKey) {
    config.credentials = defaultCredentials;
    return config;
  }
  
  // No static credentials found - will use default provider chain
  // This may cause dynamic import issues in Jest, but is a fallback
  return config;
}
