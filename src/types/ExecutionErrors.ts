/**
 * Execution Errors - Phase 4: Typed errors for SFN retry/catch logic
 * 
 * Provides typed error classes with error_class, error_code, and retryable flags
 * for Step Functions to make retry decisions.
 */

/**
 * Base execution error with error_class for SFN decision-making
 */
export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly error_class: 'VALIDATION' | 'AUTH' | 'RATE_LIMIT' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN',
    public readonly error_code?: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Validation errors (terminal, no retry)
 */
export class IntentExpiredError extends ExecutionError {
  constructor(actionIntentId: string, expiresAt: number, now: number) {
    super(
      `ActionIntent expired: ${actionIntentId} (expires_at_epoch: ${expiresAt}, now: ${now})`,
      'VALIDATION',
      'INTENT_EXPIRED',
      false
    );
  }
}

export class KillSwitchEnabledError extends ExecutionError {
  constructor(tenantId: string, actionType?: string) {
    const message = actionType
      ? `Execution disabled for tenant: ${tenantId}, action_type: ${actionType}`
      : `Execution disabled for tenant: ${tenantId}`;
    super(message, 'VALIDATION', 'KILL_SWITCH_ENABLED', false);
  }
}

export class IntentNotFoundError extends ExecutionError {
  constructor(actionIntentId: string) {
    super(`ActionIntent not found: ${actionIntentId}`, 'VALIDATION', 'INTENT_NOT_FOUND', false);
  }
}

export class ValidationError extends ExecutionError {
  constructor(message: string, errorCode?: string) {
    super(message, 'VALIDATION', errorCode || 'VALIDATION_FAILED', false);
  }
}

/**
 * Auth errors (terminal, no retry unless token refresh exists)
 */
export class AuthError extends ExecutionError {
  constructor(message: string, errorCode?: string) {
    super(message, 'AUTH', errorCode || 'AUTH_FAILED', false);
  }
}

/**
 * Rate limit errors (retryable with backoff)
 */
export class RateLimitError extends ExecutionError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(message, 'RATE_LIMIT', 'RATE_LIMIT_EXCEEDED', true);
    // Note: retryAfterSeconds can be used by SFN for exponential backoff
  }
}

/**
 * Downstream service errors (retryable with backoff)
 */
export class DownstreamError extends ExecutionError {
  constructor(message: string, errorCode?: string) {
    super(message, 'DOWNSTREAM', errorCode || 'DOWNSTREAM_ERROR', true);
  }
}

/**
 * Timeout errors (retryable with backoff)
 */
export class TimeoutError extends ExecutionError {
  constructor(message: string) {
    super(message, 'TIMEOUT', 'TIMEOUT', true);
  }
}

/**
 * Unknown errors (terminal, no retry - fail safe)
 */
export class UnknownExecutionError extends ExecutionError {
  constructor(message: string, originalError?: Error) {
    super(message, 'UNKNOWN', 'UNKNOWN_ERROR', false);
    if (originalError) {
      this.cause = originalError;
    }
  }
}
