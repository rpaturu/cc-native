import { Logger } from '../../../services/core/Logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('TestService');
    // Logger uses console.log for all levels (stdout-only)
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    // Logger.debug() only logs if LOG_LEVEL=debug, so we use console.log spy
    consoleDebugSpy = consoleLogSpy;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('info', () => {
    it('should log info messages with structured format', () => {
      logger.info('Test message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const callArg = consoleLogSpy.mock.calls[0][0];
      // Logger uses format: [timestamp] [LEVEL] [service] message {metadata}
      expect(callArg).toContain('[INFO]');
      expect(callArg).toContain('[TestService]');
      expect(callArg).toContain('Test message');
      expect(callArg).toContain('"key":"value"');
    });

    it('should handle messages without metadata', () => {
      logger.info('Simple message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const callArg = consoleLogSpy.mock.calls[0][0];
      expect(callArg).toContain('[INFO]');
      expect(callArg).toContain('Simple message');
    });
  });

  describe('error', () => {
    it('should log error messages with structured format', () => {
      logger.error('Error message', { error: 'test error' });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const callArg = consoleErrorSpy.mock.calls[0][0];
      expect(callArg).toContain('[ERROR]');
      expect(callArg).toContain('[TestService]');
      expect(callArg).toContain('Error message');
      expect(callArg).toContain('"error":"test error"');
    });

    it('should handle Error objects', () => {
      const error = new Error('Test error');
      logger.error('Failed', { error: error.message });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const callArg = consoleErrorSpy.mock.calls[0][0];
      expect(callArg).toContain('"error":"Test error"');
    });
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      logger.warn('Warning message', { warning: 'test' });

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const callArg = consoleWarnSpy.mock.calls[0][0];
      expect(callArg).toContain('[WARN]');
      expect(callArg).toContain('Warning message');
      expect(callArg).toContain('"warning":"test"');
    });
  });

  describe('debug', () => {
    it('should log debug messages when LOG_LEVEL=debug', () => {
      // Set LOG_LEVEL to debug
      const originalLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'debug';

      logger.debug('Debug message', { debug: 'test' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const callArg = consoleLogSpy.mock.calls[0][0];
      expect(callArg).toContain('[DEBUG]');
      expect(callArg).toContain('Debug message');

      // Restore original LOG_LEVEL
      if (originalLogLevel) {
        process.env.LOG_LEVEL = originalLogLevel;
      } else {
        delete process.env.LOG_LEVEL;
      }
    });

    it('should not log debug messages when LOG_LEVEL is not debug', () => {
      // Set LOG_LEVEL to info
      const originalLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'info';

      logger.debug('Debug message', { debug: 'test' });

      expect(consoleLogSpy).not.toHaveBeenCalled();

      // Restore original LOG_LEVEL
      if (originalLogLevel) {
        process.env.LOG_LEVEL = originalLogLevel;
      } else {
        delete process.env.LOG_LEVEL;
      }
    });
  });
});
