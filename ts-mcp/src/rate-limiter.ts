/**
 * Rate Limiter for Jira API
 *
 * Implements:
 * - Request throttling with configurable concurrency
 * - Exponential backoff with jitter for retries
 * - Request queuing for bulk operations
 * - Rate limit header monitoring
 */

import { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from "axios";
import { logger } from "./logger.js";

// Configuration from environment or defaults
export interface RateLimitConfig {
  maxConcurrent: number;      // Max concurrent requests (default: 5)
  maxRetries: number;         // Max retry attempts (default: 4)
  initialDelayMs: number;     // Initial retry delay (default: 1000ms)
  maxDelayMs: number;         // Max retry delay (default: 30000ms)
  jitterMin: number;          // Jitter multiplier min (default: 0.7)
  jitterMax: number;          // Jitter multiplier max (default: 1.3)
  requestDelayMs: number;     // Delay between requests (default: 100ms)
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxConcurrent: 1,           // Sequential requests - one at a time
  maxRetries: 4,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMin: 0.7,
  jitterMax: 1.3,
  requestDelayMs: 100,
};

export function getConfigFromEnv(): RateLimitConfig {
  return {
    maxConcurrent: parseInt(process.env.JIRA_MAX_CONCURRENT || "1", 10),
    maxRetries: parseInt(process.env.JIRA_MAX_RETRIES || "4", 10),
    initialDelayMs: parseInt(process.env.JIRA_INITIAL_DELAY_MS || "1000", 10),
    maxDelayMs: parseInt(process.env.JIRA_MAX_DELAY_MS || "30000", 10),
    jitterMin: parseFloat(process.env.JIRA_JITTER_MIN || "0.7"),
    jitterMax: parseFloat(process.env.JIRA_JITTER_MAX || "1.3"),
    requestDelayMs: parseInt(process.env.JIRA_REQUEST_DELAY_MS || "100", 10),
  };
}

// Rate limit state tracking
interface RateLimitState {
  remaining: number | null;
  resetAt: Date | null;
  nearLimit: boolean;
  lastRequestTime: number;
}

// Retry metadata attached to request config
interface RetryMetadata {
  retryCount: number;
  lastDelay: number;
}

// Extended request config with retry metadata and timing
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retryMetadata?: RetryMetadata;
  _requestStartTime?: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private state: RateLimitState;
  private activeRequests: number = 0;
  private requestQueue: Array<() => void> = [];

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...getConfigFromEnv(), ...config };
    this.state = {
      remaining: null,
      resetAt: null,
      nearLimit: false,
      lastRequestTime: 0,
    };
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateBackoff(retryCount: number, lastDelay: number): number {
    // Double the delay for each retry, capped at maxDelayMs
    const baseDelay = Math.min(
      retryCount === 0 ? this.config.initialDelayMs : lastDelay * 2,
      this.config.maxDelayMs
    );

    // Apply jitter to avoid thundering herd
    const jitter = this.config.jitterMin +
      Math.random() * (this.config.jitterMax - this.config.jitterMin);

    return Math.floor(baseDelay * jitter);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if we should throttle the request
   */
  private shouldThrottle(): boolean {
    // Throttle if at max concurrent requests
    if (this.activeRequests >= this.config.maxConcurrent) {
      return true;
    }

    // Throttle if near rate limit
    if (this.state.nearLimit && this.state.remaining !== null && this.state.remaining < 5) {
      return true;
    }

    return false;
  }

  /**
   * Wait for a slot to become available
   */
  private waitForSlot(): Promise<void> {
    return new Promise(resolve => {
      if (!this.shouldThrottle()) {
        resolve();
        return;
      }
      this.requestQueue.push(resolve);
    });
  }

  /**
   * Release a slot and process queue
   */
  private releaseSlot(): void {
    this.activeRequests--;
    const next = this.requestQueue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Parse rate limit headers from response
   */
  private parseRateLimitHeaders(response: AxiosResponse): void {
    const headers = response.headers;

    // X-RateLimit-Remaining
    const remaining = headers["x-ratelimit-remaining"];
    if (remaining !== undefined) {
      this.state.remaining = parseInt(remaining, 10);
    }

    // X-RateLimit-Reset
    const reset = headers["x-ratelimit-reset"];
    if (reset) {
      this.state.resetAt = new Date(reset);
    }

    // X-RateLimit-NearLimit
    const nearLimit = headers["x-ratelimit-nearlimit"];
    this.state.nearLimit = nearLimit === "true";

    // Log rate limit state for observability
    if (this.state.nearLimit) {
      logger.warn("Near rate limit", {
        operation: "rate_limit_check",
        remaining: this.state.remaining,
        resetAt: this.state.resetAt?.toISOString(),
      });
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: AxiosError): boolean {
    // Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
    if (!error.response) {
      return true;
    }

    const status = error.response.status;

    // Rate limited
    if (status === 429) {
      return true;
    }

    // Server errors (might be transient)
    if (status >= 500 && status < 600) {
      return true;
    }

    // Service unavailable with Retry-After
    if (status === 503 && error.response.headers["retry-after"]) {
      return true;
    }

    return false;
  }

  /**
   * Get retry delay from error response
   */
  private getRetryDelayFromResponse(error: AxiosError): number | null {
    if (!error.response) return null;

    const retryAfter = error.response.headers["retry-after"];
    if (retryAfter) {
      // Retry-After can be seconds or HTTP date
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
      // Try parsing as date
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    }

    return null;
  }

  /**
   * Apply rate limiting to an axios instance
   */
  public applyTo(axiosInstance: AxiosInstance): void {
    // Request interceptor - throttling and timing
    axiosInstance.interceptors.request.use(
      async (config: ExtendedAxiosRequestConfig) => {
        // Wait for available slot
        await this.waitForSlot();

        // Ensure minimum delay between requests
        const now = Date.now();
        const timeSinceLastRequest = now - this.state.lastRequestTime;
        if (timeSinceLastRequest < this.config.requestDelayMs) {
          await this.delay(this.config.requestDelayMs - timeSinceLastRequest);
        }

        this.activeRequests++;
        this.state.lastRequestTime = Date.now();

        // Initialize retry metadata if not present
        if (!config._retryMetadata) {
          config._retryMetadata = { retryCount: 0, lastDelay: this.config.initialDelayMs };
        }

        // Record request start time for metrics
        config._requestStartTime = Date.now();

        // Log request
        logger.request(config.method?.toUpperCase() || "GET", config.url || "");

        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor - parse headers and handle success
    axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        this.releaseSlot();
        this.parseRateLimitHeaders(response);

        // Calculate duration and log response
        const config = response.config as ExtendedAxiosRequestConfig;
        const duration = config._requestStartTime ? Date.now() - config._requestStartTime : 0;
        logger.response(
          config.method?.toUpperCase() || "GET",
          config.url || "",
          response.status,
          duration
        );

        return response;
      },
      async (error: AxiosError) => {
        this.releaseSlot();

        const config = error.config as ExtendedAxiosRequestConfig | undefined;

        if (!config || !this.isRetryableError(error)) {
          return Promise.reject(error);
        }

        const metadata = config._retryMetadata || { retryCount: 0, lastDelay: this.config.initialDelayMs };

        // Check if we've exceeded max retries
        if (metadata.retryCount >= this.config.maxRetries) {
          logger.error("Max retries exceeded", {
            operation: "retry_exhausted",
            url: config.url,
            maxRetries: this.config.maxRetries,
            lastError: error.response?.status || error.code,
          });
          return Promise.reject(error);
        }

        // Calculate delay
        let delayMs = this.getRetryDelayFromResponse(error);
        if (delayMs === null) {
          delayMs = this.calculateBackoff(metadata.retryCount, metadata.lastDelay);
        }

        // Log retry attempt
        logger.info("Retrying request", {
          operation: "retry_attempt",
          url: config.url,
          attempt: metadata.retryCount + 1,
          maxRetries: this.config.maxRetries,
          delayMs,
          error: error.response?.status || error.code || "unknown",
        });

        // Wait before retry
        await this.delay(delayMs);

        // Update retry metadata
        config._retryMetadata = {
          retryCount: metadata.retryCount + 1,
          lastDelay: delayMs,
        };

        // Retry the request
        return axiosInstance.request(config);
      }
    );
  }

  /**
   * Get current rate limit state (for monitoring)
   */
  public getState(): RateLimitState & { activeRequests: number; queueLength: number } {
    return {
      ...this.state,
      activeRequests: this.activeRequests,
      queueLength: this.requestQueue.length,
    };
  }
}
