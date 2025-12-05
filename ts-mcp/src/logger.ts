/**
 * Structured Logger for Jira MCP Server
 *
 * Features:
 * - JSON structured logging for easy parsing
 * - Correlation IDs for tracking related operations
 * - Request/response timing metrics
 * - Configurable log levels via environment
 * - MCP server compatible (stderr output)
 */

import { randomUUID } from "crypto";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export interface LogContext {
  correlationId?: string;
  operation?: string;
  target?: string;
  duration?: number;
  requestId?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

export interface LoggerConfig {
  level: LogLevel;
  jsonFormat: boolean;
  includeTimestamp: boolean;
  correlationIdHeader: string;
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.SILENT]: "SILENT",
};

function parseLogLevel(level: string | undefined): LogLevel {
  if (!level) return LogLevel.INFO;
  const normalized = level.toUpperCase();
  switch (normalized) {
    case "DEBUG": return LogLevel.DEBUG;
    case "INFO": return LogLevel.INFO;
    case "WARN": return LogLevel.WARN;
    case "ERROR": return LogLevel.ERROR;
    case "SILENT": return LogLevel.SILENT;
    default: return LogLevel.INFO;
  }
}

export function getLoggerConfigFromEnv(): LoggerConfig {
  return {
    level: parseLogLevel(process.env.JIRA_LOG_LEVEL),
    jsonFormat: process.env.JIRA_LOG_JSON !== "false",
    includeTimestamp: process.env.JIRA_LOG_TIMESTAMP !== "false",
    correlationIdHeader: process.env.JIRA_CORRELATION_HEADER || "X-Correlation-ID",
  };
}

/**
 * Correlation context for tracking related operations
 */
class CorrelationContext {
  private static currentId: string | undefined;

  static get(): string {
    if (!this.currentId) {
      this.currentId = randomUUID();
    }
    return this.currentId;
  }

  static set(id: string): void {
    this.currentId = id;
  }

  static clear(): void {
    this.currentId = undefined;
  }

  static run<T>(fn: () => T, correlationId?: string): T {
    const previousId = this.currentId;
    this.currentId = correlationId || randomUUID();
    try {
      return fn();
    } finally {
      this.currentId = previousId;
    }
  }

  static async runAsync<T>(fn: () => Promise<T>, correlationId?: string): Promise<T> {
    const previousId = this.currentId;
    this.currentId = correlationId || randomUUID();
    try {
      return await fn();
    } finally {
      this.currentId = previousId;
    }
  }
}

/**
 * Request metrics collector
 */
export interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDuration: number;
  averageDuration: number;
  requestsByEndpoint: Map<string, number>;
  errorsByType: Map<string, number>;
}

class MetricsCollector {
  private metrics: RequestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalDuration: 0,
    averageDuration: 0,
    requestsByEndpoint: new Map(),
    errorsByType: new Map(),
  };

  recordRequest(endpoint: string, duration: number, success: boolean, errorType?: string): void {
    this.metrics.totalRequests++;
    this.metrics.totalDuration += duration;
    this.metrics.averageDuration = this.metrics.totalDuration / this.metrics.totalRequests;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
      if (errorType) {
        const count = this.metrics.errorsByType.get(errorType) || 0;
        this.metrics.errorsByType.set(errorType, count + 1);
      }
    }

    const endpointCount = this.metrics.requestsByEndpoint.get(endpoint) || 0;
    this.metrics.requestsByEndpoint.set(endpoint, endpointCount + 1);
  }

  getMetrics(): RequestMetrics {
    return { ...this.metrics };
  }

  getMetricsSummary(): Record<string, unknown> {
    return {
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      successRate: this.metrics.totalRequests > 0
        ? Math.round((this.metrics.successfulRequests / this.metrics.totalRequests) * 100)
        : 100,
      averageDurationMs: Math.round(this.metrics.averageDuration),
      topEndpoints: Array.from(this.metrics.requestsByEndpoint.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([endpoint, count]) => ({ endpoint, count })),
      errorTypes: Object.fromEntries(this.metrics.errorsByType),
    };
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalDuration: 0,
      averageDuration: 0,
      requestsByEndpoint: new Map(),
      errorsByType: new Map(),
    };
  }
}

/**
 * Main Logger class
 */
export class Logger {
  private config: LoggerConfig;
  private static instance: Logger;
  public readonly correlation = CorrelationContext;
  public readonly metrics = new MetricsCollector();

  constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...getLoggerConfigFromEnv(), ...config };
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LOG_LEVEL_NAMES[level],
      message,
      correlationId: context?.correlationId || CorrelationContext.get(),
    };

    if (context) {
      const { correlationId, ...rest } = context;
      if (Object.keys(rest).length > 0) {
        entry.context = rest;
      }
    }

    if (this.config.jsonFormat) {
      return JSON.stringify(entry);
    }

    // Human-readable format
    const parts: string[] = [];
    if (this.config.includeTimestamp) {
      parts.push(`[${entry.timestamp}]`);
    }
    parts.push(`[${entry.level}]`);
    if (entry.correlationId) {
      parts.push(`[${entry.correlationId.slice(0, 8)}]`);
    }
    parts.push(message);
    if (entry.context) {
      parts.push(JSON.stringify(entry.context));
    }
    return parts.join(" ");
  }

  private output(message: string): void {
    // MCP servers must use stderr for logging (stdout is for protocol)
    process.stderr.write(message + "\n");
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.output(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.output(this.formatMessage(LogLevel.INFO, message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.output(this.formatMessage(LogLevel.WARN, message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.output(this.formatMessage(LogLevel.ERROR, message, context));
    }
  }

  /**
   * Log an API request with timing
   */
  request(method: string, url: string, context?: LogContext): void {
    this.debug(`API Request: ${method} ${url}`, {
      ...context,
      operation: "api_request",
      method,
      url,
    });
  }

  /**
   * Log an API response with timing
   */
  response(method: string, url: string, status: number, duration: number, context?: LogContext): void {
    const isSuccess = status >= 200 && status < 400;
    const logFn = isSuccess ? this.info.bind(this) : this.warn.bind(this);

    logFn(`API Response: ${method} ${url} - ${status} (${duration}ms)`, {
      ...context,
      operation: "api_response",
      method,
      url,
      status,
      duration,
    });

    // Record metrics
    const endpoint = this.normalizeEndpoint(url);
    this.metrics.recordRequest(endpoint, duration, isSuccess, isSuccess ? undefined : `HTTP_${status}`);
  }

  /**
   * Log an operation start
   */
  operationStart(operation: string, target: string, context?: LogContext): string {
    const requestId = randomUUID();
    this.debug(`Operation started: ${operation}`, {
      ...context,
      operation,
      target,
      requestId,
    });
    return requestId;
  }

  /**
   * Log an operation completion
   */
  operationEnd(operation: string, target: string, duration: number, success: boolean, context?: LogContext): void {
    const logFn = success ? this.info.bind(this) : this.error.bind(this);
    logFn(`Operation ${success ? "completed" : "failed"}: ${operation}`, {
      ...context,
      operation,
      target,
      duration,
      success,
    });
  }

  /**
   * Create a child logger with preset context
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Get current metrics summary
   */
  getMetricsSummary(): Record<string, unknown> {
    return this.metrics.getMetricsSummary();
  }

  /**
   * Normalize endpoint for metrics grouping
   */
  private normalizeEndpoint(url: string): string {
    // Remove base URL, replace IDs with placeholders
    return url
      .replace(/\/rest\/api\/3/, "")
      .replace(/\/rest\/agile\/1\.0/, "")
      .replace(/\/[A-Z]+-\d+/g, "/{issueKey}")
      .replace(/\/\d+/g, "/{id}");
  }

  /**
   * Set log level at runtime
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

/**
 * Child logger with preset context
 */
class ChildLogger {
  constructor(
    private parent: Logger,
    private context: LogContext
  ) {}

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, { ...this.context, ...context });
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, { ...this.context, ...context });
  }

  warn(message: string, context?: LogContext): void {
    this.parent.warn(message, { ...this.context, ...context });
  }

  error(message: string, context?: LogContext): void {
    this.parent.error(message, { ...this.context, ...context });
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export correlation context for external use
export { CorrelationContext };
