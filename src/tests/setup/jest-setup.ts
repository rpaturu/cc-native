/**
 * Jest Setup File
 * 
 * Loads environment variables and configures AWS SDK for tests.
 * This runs before all tests.
 */

// Only show setup logs in verbose mode or when JEST_VERBOSE is set
const isVerbose = process.env.JEST_VERBOSE === 'true' || process.argv.includes('--verbose');

// Load .env.local first (local overrides), then .env (deployment config)
let fs: any;
try {
  const dotenv = require('dotenv');
  const path = require('path');
  fs = require('fs');
  
  // Load .env.local if it exists (local overrides)
  const envLocalPath = path.join(__dirname, '../../../.env.local');
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
    if (isVerbose) {
      console.log('✓ Loaded .env.local');
    }
  }
  
  // Load .env if it exists (deployment config)
  const envPath = path.join(__dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    if (isVerbose) {
      console.log('✓ Loaded .env');
    }
  }
} catch (error) {
  // dotenv not available, continue
  console.warn('dotenv not available, using process.env directly');
}

// Helper function to detect if running on EC2
function isRunningOnEC2(): boolean {
  // Check for EC2 instance metadata service (available on EC2)
  // Also check for common EC2 environment indicators
  try {
    // Check environment variables that indicate EC2
    if (process.env.EC2_INSTANCE_ID || process.env.AWS_EXECUTION_ENV?.includes('EC2')) {
      return true;
    }
    
    // Check for EC2 hostname pattern (ip-*-*-*-*)
    if (typeof process !== 'undefined' && typeof require !== 'undefined') {
      const os = require('os');
      const hostname = os.hostname();
      if (hostname && /^ip-\d+-\d+-\d+-\d+/.test(hostname)) {
        return true;
      }
    }
    
    // Check for EC2 system files (non-blocking)
    if (process.platform === 'linux' && fs && fs.existsSync) {
      try {
        if (fs.existsSync('/sys/class/dmi/id/product_uuid')) {
          // Read first few bytes to check if it's EC2 format
          const uuid = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8');
          // EC2 UUIDs typically start with 'ec2' or are in a specific format
          if (uuid && (uuid.includes('ec2') || uuid.length > 0)) {
            return true;
          }
        }
      } catch {
        // Ignore errors reading system files
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

// Configure AWS SDK to use environment variables for credentials
// Set AWS_SDK_LOAD_CONFIG to ensure credentials are loaded from environment
process.env.AWS_SDK_LOAD_CONFIG = '1';

const isEC2 = isRunningOnEC2();

// If credentials are in environment variables, AWS SDK will use them automatically
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  if (isVerbose) {
    console.log('✓ AWS credentials found in environment variables');
  }
} else if (process.env.AWS_PROFILE) {
  if (isVerbose) {
    console.log(`✓ Using AWS profile: ${process.env.AWS_PROFILE}`);
  }
} else {
  // Try to use default credential chain (~/.aws/credentials or EC2 instance metadata)
  if (isEC2) {
    // On EC2, credentials come from instance metadata (IAM role) - this is expected
    if (isVerbose) {
      console.log('✓ Running on EC2 - will use IAM role credentials from instance metadata');
    }
  } else {
    // Local development - show warning about .env.local
    console.warn('⚠ No AWS credentials found in environment. Using default credential chain.');
    console.warn('  Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE in .env.local');
  }
}

// Mock AWS SDK credential provider to avoid dynamic import issues
// This prevents ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG error
// On EC2 instances, manually fetch credentials from instance metadata service
jest.mock('@aws-sdk/credential-provider-node', () => {
  const originalModule = jest.requireActual('@aws-sdk/credential-provider-node');
  const http = require('http');
  
  // Function to fetch credentials from EC2 instance metadata service (IMDSv2)
  // IMDSv2 requires a token for security. First get token, then use it for requests.
  async function fetchEC2Credentials(): Promise<any> {
    return new Promise((resolve, reject) => {
      // Step 1: Get IMDSv2 token
      const tokenOptions = {
        hostname: '169.254.169.254',
        port: 80,
        path: '/latest/api/token',
        method: 'PUT',
        headers: {
          'X-aws-ec2-metadata-token-ttl-seconds': '21600', // 6 hours
        },
        timeout: 5000,
      };
      
      const tokenReq = http.request(tokenOptions, (tokenRes: any) => {
        if (tokenRes.statusCode !== 200) {
          // Try IMDSv1 as fallback
          fetchWithIMDSv1(resolve, reject);
          return;
        }
        
        let tokenData = '';
        tokenRes.on('data', (chunk: any) => { tokenData += chunk; });
        tokenRes.on('end', () => {
          const token = tokenData.trim();
          if (!token) {
            fetchWithIMDSv1(resolve, reject);
            return;
          }
          
          // Step 2: Get IAM role name using token
          const roleOptions = {
            hostname: '169.254.169.254',
            port: 80,
            path: '/latest/meta-data/iam/security-credentials/',
            method: 'GET',
            headers: {
              'X-aws-ec2-metadata-token': token,
            },
            timeout: 5000,
          };
          
          const roleReq = http.request(roleOptions, (roleRes: any) => {
            if (roleRes.statusCode !== 200) {
              reject(new Error(`Metadata service returned status ${roleRes.statusCode}`));
              return;
            }
            
            let roleData = '';
            roleRes.on('data', (chunk: any) => { roleData += chunk; });
            roleRes.on('end', () => {
              const roleName = roleData.trim().split('\n')[0];
              if (!roleName) {
                reject(new Error('No IAM role found'));
                return;
              }
              
              // Step 3: Get credentials for the role using token
              const credOptions = {
                hostname: '169.254.169.254',
                port: 80,
                path: `/latest/meta-data/iam/security-credentials/${roleName}`,
                method: 'GET',
                headers: {
                  'X-aws-ec2-metadata-token': token,
                },
                timeout: 5000,
              };
              
              const credReq = http.request(credOptions, (credRes: any) => {
                if (credRes.statusCode !== 200) {
                  reject(new Error(`Credentials endpoint returned status ${credRes.statusCode}`));
                  return;
                }
                
                let credData = '';
                credRes.on('data', (chunk: any) => { credData += chunk; });
                credRes.on('end', () => {
                  try {
                    const creds = JSON.parse(credData);
                    if (!creds.AccessKeyId || !creds.SecretAccessKey) {
                      reject(new Error('Invalid credentials format from metadata service'));
                      return;
                    }
                    resolve({
                      accessKeyId: creds.AccessKeyId,
                      secretAccessKey: creds.SecretAccessKey,
                      sessionToken: creds.Token,
                    });
                  } catch (e) {
                    reject(new Error(`Failed to parse credentials: ${e}`));
                  }
                });
              });
              
              credReq.on('error', (err: any) => {
                reject(new Error(`Error fetching credentials: ${err.message}`));
              });
              credReq.on('timeout', () => {
                credReq.destroy();
                reject(new Error('Timeout fetching credentials from metadata service'));
              });
              credReq.setTimeout(5000);
              credReq.end();
            });
          });
          
          roleReq.on('error', (err: any) => {
            reject(new Error(`Error accessing metadata service: ${err.message}`));
          });
          roleReq.on('timeout', () => {
            roleReq.destroy();
            reject(new Error('Timeout accessing metadata service'));
          });
          roleReq.setTimeout(5000);
          roleReq.end();
        });
      });
      
      tokenReq.on('error', () => {
        // Fallback to IMDSv1
        fetchWithIMDSv1(resolve, reject);
      });
      tokenReq.on('timeout', () => {
        tokenReq.destroy();
        fetchWithIMDSv1(resolve, reject);
      });
      tokenReq.setTimeout(5000);
      tokenReq.end();
    });
  }
  
  // Fallback function for IMDSv1 (if IMDSv2 is not available)
  function fetchWithIMDSv1(resolve: any, reject: any) {
    const roleOptions = {
      hostname: '169.254.169.254',
      port: 80,
      path: '/latest/meta-data/iam/security-credentials/',
      method: 'GET',
      timeout: 5000,
    };
    
    const roleReq = http.request(roleOptions, (roleRes: any) => {
      if (roleRes.statusCode !== 200) {
        reject(new Error(`Metadata service returned status ${roleRes.statusCode}`));
        return;
      }
      
      let roleData = '';
      roleRes.on('data', (chunk: any) => { roleData += chunk; });
      roleRes.on('end', () => {
        const roleName = roleData.trim().split('\n')[0];
        if (!roleName) {
          reject(new Error('No IAM role found'));
          return;
        }
        
        const credOptions = {
          hostname: '169.254.169.254',
          port: 80,
          path: `/latest/meta-data/iam/security-credentials/${roleName}`,
          method: 'GET',
          timeout: 5000,
        };
        
        const credReq = http.request(credOptions, (credRes: any) => {
          if (credRes.statusCode !== 200) {
            reject(new Error(`Credentials endpoint returned status ${credRes.statusCode}`));
            return;
          }
          
          let credData = '';
          credRes.on('data', (chunk: any) => { credData += chunk; });
          credRes.on('end', () => {
            try {
              const creds = JSON.parse(credData);
              if (!creds.AccessKeyId || !creds.SecretAccessKey) {
                reject(new Error('Invalid credentials format from metadata service'));
                return;
              }
              resolve({
                accessKeyId: creds.AccessKeyId,
                secretAccessKey: creds.SecretAccessKey,
                sessionToken: creds.Token,
              });
            } catch (e) {
              reject(new Error(`Failed to parse credentials: ${e}`));
            }
          });
        });
        
        credReq.on('error', (err: any) => {
          reject(new Error(`Error fetching credentials: ${err.message}`));
        });
        credReq.on('timeout', () => {
          credReq.destroy();
          reject(new Error('Timeout fetching credentials from metadata service'));
        });
        credReq.setTimeout(5000);
        credReq.end();
      });
    });
    
    roleReq.on('error', (err: any) => {
      reject(new Error(`Error accessing metadata service: ${err.message}`));
    });
    roleReq.on('timeout', () => {
      roleReq.destroy();
      reject(new Error('Timeout accessing metadata service'));
    });
    roleReq.setTimeout(5000);
    roleReq.end();
  }
  
  // If AWS credentials are in environment variables, use them
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    // Return a mock that uses static credentials from environment
    return {
      ...originalModule,
      defaultProvider: jest.fn(() => {
        return Promise.resolve({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
        });
      }),
    };
  }
  // In Jest we never hit the network: use test credentials to avoid open TCP handles
  // (fetchEC2Credentials uses http.request to 169.254.169.254 and leaves sockets open)
  if (process.env.JEST_WORKER_ID !== undefined) {
    return {
      ...originalModule,
      defaultProvider: jest.fn(() =>
        Promise.resolve({
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        })
      ),
    };
  }
  // Not in Jest (e.g. real EC2) - try to fetch from EC2 instance metadata
  return {
    ...originalModule,
    defaultProvider: jest.fn(async () => {
      try {
        const creds = await fetchEC2Credentials();
        if (isVerbose) {
          console.log('✓ Successfully fetched credentials from EC2 instance metadata');
        }
        return creds;
      } catch (e: any) {
        console.warn(`⚠ Failed to fetch credentials from EC2 metadata: ${e.message}`);
        console.warn('  Falling back to test credentials (tests may fail with "invalid security token")');
        return {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        };
      }
    }),
  };
});

// Suppress console output during tests to avoid "● Console" blocks in Jest output.
// Runs after setup file's own console usage. Tests that assert on console (e.g. Logger.test.ts)
// can use jest.spyOn(console, 'warn') etc. and will override this noop.
const noop = () => {};
console.warn = noop;
console.log = noop;
console.error = noop;
