/**
 * Error Classification Tests - Phase 4.2
 * 
 * Tests error classification logic for retryability and error types.
 */

import { AxiosError } from 'axios';

// Error classification functions (extracted from ToolInvoker handler for testing)
function isRetryableError(error: any): boolean {
  if (error instanceof AxiosError) {
    // 5xx errors are retryable (server failures)
    if (error.response?.status && error.response.status >= 500) {
      return true;
    }
    
    // 429 rate limiting is retryable (with exponential backoff)
    if (error.response?.status === 429) {
      return true;
    }
    
    // Network errors are retryable
    const retryableNetworkCodes = [
      'ECONNRESET',    // Connection reset by peer
      'ETIMEDOUT',     // Connection timeout
      'ENOTFOUND',     // DNS lookup failed
      'EAI_AGAIN',     // DNS temporary failure
      'ECONNREFUSED',  // Connection refused
    ];
    if (error.code && retryableNetworkCodes.includes(error.code)) {
      return true;
    }
  }
  
  // Non-Axios network errors (e.g., from fetch or other HTTP clients)
  if (error.code && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) {
    return true;
  }
  
  return false;
}

function classifyError(parsedResponse: any): {
  error_code?: string;
  error_class?: 'AUTH' | 'RATE_LIMIT' | 'VALIDATION' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN';
  error_message?: string;
} {
  if (parsedResponse.success) {
    return {};
  }
  
  const error = parsedResponse.error || parsedResponse;
  const errorMessage = error.message || error.error;
  if (!errorMessage) {
    throw new Error('Tool invocation failed but no error message was provided');
  }
  
  // Classify by error message patterns
  if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
    return {
      error_code: 'AUTH_FAILED',
      error_class: 'AUTH',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('throttle')) {
    return {
      error_code: 'RATE_LIMIT',
      error_class: 'RATE_LIMIT',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return {
      error_code: 'VALIDATION_ERROR',
      error_class: 'VALIDATION',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('timeout')) {
    return {
      error_code: 'TIMEOUT',
      error_class: 'TIMEOUT',
      error_message: errorMessage,
    };
  }
  
  return {
    error_code: 'UNKNOWN_ERROR',
    error_class: 'UNKNOWN',
    error_message: errorMessage,
  };
}

describe('Error Classification', () => {
  describe('Network Error Classification', () => {
    it('should classify ECONNRESET as retryable', () => {
      const error = { code: 'ECONNRESET' };
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify ETIMEDOUT as retryable', () => {
      const error = { code: 'ETIMEDOUT' };
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify ENOTFOUND as retryable', () => {
      const error = { code: 'ENOTFOUND' };
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify EAI_AGAIN as retryable', () => {
      const error = { code: 'EAI_AGAIN' };
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify ECONNREFUSED as retryable', () => {
      const error = { code: 'ECONNREFUSED' };
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('HTTP Status Code Classification', () => {
    it('should classify 5xx errors as retryable', () => {
      const error500 = new AxiosError('Server error');
      error500.response = { status: 500 } as any;
      const error502 = new AxiosError('Bad gateway');
      error502.response = { status: 502 } as any;
      const error503 = new AxiosError('Service unavailable');
      error503.response = { status: 503 } as any;

      expect(isRetryableError(error500)).toBe(true);
      expect(isRetryableError(error502)).toBe(true);
      expect(isRetryableError(error503)).toBe(true);
    });

    it('should classify 429 as retryable', () => {
      const error = new AxiosError('Rate limited');
      error.response = { status: 429 } as any;
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify 4xx (except 429) as non-retryable', () => {
      const error400 = new AxiosError('Bad request');
      error400.response = { status: 400 } as any;
      const error401 = new AxiosError('Unauthorized');
      error401.response = { status: 401 } as any;
      const error403 = new AxiosError('Forbidden');
      error403.response = { status: 403 } as any;
      const error404 = new AxiosError('Not found');
      error404.response = { status: 404 } as any;

      expect(isRetryableError(error400)).toBe(false);
      expect(isRetryableError(error401)).toBe(false);
      expect(isRetryableError(error403)).toBe(false);
      expect(isRetryableError(error404)).toBe(false);
    });

    it('should classify 3xx as non-retryable', () => {
      const error301 = new AxiosError('Moved permanently');
      error301.response = { status: 301 } as any;
      const error302 = new AxiosError('Found');
      error302.response = { status: 302 } as any;

      expect(isRetryableError(error301)).toBe(false);
      expect(isRetryableError(error302)).toBe(false);
    });

    it('should classify 2xx as non-retryable (success)', () => {
      const error200 = new AxiosError('OK');
      error200.response = { status: 200 } as any;
      const error201 = new AxiosError('Created');
      error201.response = { status: 201 } as any;

      expect(isRetryableError(error200)).toBe(false);
      expect(isRetryableError(error201)).toBe(false);
    });
  });

  describe('Error Message Pattern Classification', () => {
    it('should classify authentication errors as AUTH', () => {
      const response = {
        success: false,
        error: { message: 'authentication failed' }, // lowercase to match implementation
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('AUTH_FAILED');
      expect(classification.error_class).toBe('AUTH');
    });

    it('should classify unauthorized errors as AUTH', () => {
      const response = {
        success: false,
        error: { message: 'unauthorized access denied' }, // lowercase to match implementation
      };

      const classification = classifyError(response);
      expect(classification.error_class).toBe('AUTH');
    });

    it('should classify rate limit errors as RATE_LIMIT', () => {
      const response = {
        success: false,
        error: { message: 'rate limit exceeded' }, // lowercase to match implementation
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('RATE_LIMIT');
      expect(classification.error_class).toBe('RATE_LIMIT');
    });

    it('should classify throttle errors as RATE_LIMIT', () => {
      const response = {
        success: false,
        error: { message: 'request throttle' }, // lowercase to match implementation
      };

      const classification = classifyError(response);
      expect(classification.error_class).toBe('RATE_LIMIT');
    });

    it('should classify validation errors as VALIDATION', () => {
      const response = {
        success: false,
        error: { message: 'validation failed: missing field' }, // lowercase to match implementation
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('VALIDATION_ERROR');
      expect(classification.error_class).toBe('VALIDATION');
    });

    it('should classify invalid errors as VALIDATION', () => {
      const response = {
        success: false,
        error: { message: 'invalid parameter value' }, // lowercase to match implementation
      };

      const classification = classifyError(response);
      expect(classification.error_class).toBe('VALIDATION');
    });

    it('should classify timeout errors as TIMEOUT', () => {
      const response = {
        success: false,
        error: { message: 'Request timeout after 30s' },
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('TIMEOUT');
      expect(classification.error_class).toBe('TIMEOUT');
    });

    it('should classify unknown errors as UNKNOWN', () => {
      const response = {
        success: false,
        error: { message: 'Something unexpected happened' },
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('UNKNOWN_ERROR');
      expect(classification.error_class).toBe('UNKNOWN');
    });

    it('should throw error if no error message provided', () => {
      const response = {
        success: false,
        error: {},
      };

      expect(() => classifyError(response)).toThrow('Tool invocation failed but no error message was provided');
    });

    it('should return empty object if success=true', () => {
      const response = {
        success: true,
      };

      const classification = classifyError(response);
      expect(classification).toEqual({});
    });
  });
});
