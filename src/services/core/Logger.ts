import { TraceContext } from '../../types/CommonTypes';

export interface LogMeta {
  [key: string]: any;
  traceId?: string;
  tenantId?: string;
  accountId?: string;
}

export class Logger {
  private serviceName: string;
  private defaultContext?: TraceContext;

  constructor(serviceName: string, context?: TraceContext) {
    this.serviceName = serviceName;
    this.defaultContext = context;
  }

  private formatMessage(
    level: string,
    message: string,
    meta?: LogMeta
  ): string {
    const timestamp = new Date().toISOString();
    const enrichedMeta = {
      ...this.defaultContext,
      ...meta,
    };
    const metaStr = enrichedMeta ? ` ${JSON.stringify(enrichedMeta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.serviceName}] ${message}${metaStr}`;
  }

  info(message: string, meta?: LogMeta): void {
    console.log(this.formatMessage('info', message, meta));
  }

  error(message: string, meta?: LogMeta): void {
    console.error(this.formatMessage('error', message, meta));
  }

  warn(message: string, meta?: LogMeta): void {
    console.warn(this.formatMessage('warn', message, meta));
  }

  debug(message: string, meta?: LogMeta): void {
    const logLevel = process.env.LOG_LEVEL || 'info';
    if (logLevel === 'debug') {
      console.log(this.formatMessage('debug', message, meta));
    }
  }

  setContext(context: TraceContext): void {
    this.defaultContext = context;
  }
}
