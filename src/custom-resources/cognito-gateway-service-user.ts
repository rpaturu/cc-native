/**
 * Custom resource handler: create Cognito User Pool service user for JWT (ToolInvoker).
 * Fills Secrets Manager secret with { username, password, userPoolId, clientId, createdAt }.
 * Per JWT_SERVICE_USER_STACK_PLAN.md: AdminGetUser first (idempotency); PutSecretValue only on create or ForceRecreate.
 */

import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { randomBytes } from 'crypto';

/** Email-format username required when User Pool uses email as username (signInAliases.email: true). */
const DEFAULT_SERVICE_USERNAME = 'gateway-service@cc-native.local';

export interface ResourceProperties {
  UserPoolId: string;
  ClientId: string;
  SecretArn: string;
  Username: string;
  ForceRecreate?: string;
}

export interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: ResourceProperties;
  OldResourceProperties?: ResourceProperties;
}

function getProps(event: CustomResourceEvent): ResourceProperties {
  const p = event.ResourceProperties;
  if (!p?.UserPoolId || !p?.ClientId || !p?.SecretArn || !p?.Username) {
    throw new Error('Missing required properties: UserPoolId, ClientId, SecretArn, Username');
  }
  return p;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(24);
  let s = '';
  for (let i = 0; i < 24; i++) s += chars[bytes[i]! % chars.length];
  return s;
}

export async function handler(event: CustomResourceEvent): Promise<Record<string, unknown>> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const cognito = new CognitoIdentityProviderClient({ region });
  const secrets = new SecretsManagerClient({ region });
  const props = getProps(event);

  if (event.RequestType === 'Delete') {
    return { Message: 'No-op on delete (Cognito user retained)' };
  }

  if (event.RequestType === 'Update') {
    const forceRecreate = props.ForceRecreate === 'true' || props.ForceRecreate === '1';
    if (!forceRecreate) {
      return { Message: 'No-op on update (user exists; ForceRecreate not set)' };
    }
    const password = generatePassword();
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: props.UserPoolId,
        Username: props.Username,
        Password: password,
        Permanent: true,
      })
    );
    await secrets.send(
      new PutSecretValueCommand({
        SecretId: props.SecretArn,
        SecretString: JSON.stringify({
          username: props.Username,
          password,
          userPoolId: props.UserPoolId,
          clientId: props.ClientId,
          createdAt: new Date().toISOString(),
        }),
      })
    );
    return { Message: 'ForceRecreate: password and secret updated' };
  }

  // Create
  let userExists = false;
  try {
    await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: props.UserPoolId,
        Username: props.Username,
      })
    );
    userExists = true;
  } catch (e) {
    if (e instanceof UserNotFoundException) {
      userExists = false;
    } else {
      throw e;
    }
  }

  if (userExists) {
    return { Message: 'Service user already exists, skipping creation' };
  }

  const password = generatePassword();
  const emailValue = props.Username.includes('@') ? props.Username : DEFAULT_SERVICE_USERNAME;
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: props.UserPoolId,
      Username: props.Username,
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: emailValue },
        { Name: 'email_verified', Value: 'true' },
      ],
    })
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: props.UserPoolId,
      Username: props.Username,
      Password: password,
      Permanent: true,
    })
  );
  await secrets.send(
    new PutSecretValueCommand({
      SecretId: props.SecretArn,
      SecretString: JSON.stringify({
        username: props.Username,
        password,
        userPoolId: props.UserPoolId,
        clientId: props.ClientId,
        createdAt: new Date().toISOString(),
      }),
    })
  );
  return { Message: 'Service user created and secret written' };
}
