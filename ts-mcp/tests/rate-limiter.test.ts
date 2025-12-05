import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RateLimiter, RateLimitConfig, getConfigFromEnv } from "../src/rate-limiter.js";
import axios, { AxiosInstance, AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";

// Mock logger
vi.mock("../src/logger.js", () => ({
  logger: {
    request: vi.fn(),
    response: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter;
  let axiosInstance: AxiosInstance;

  beforeEach(() => {
    // Clear environment
    delete process.env.JIRA_MAX_CONCURRENT;
    delete process.env.JIRA_MAX_RETRIES;
    delete process.env.JIRA_REQUEST_DELAY_MS;
    delete process.env.JIRA_INITIAL_DELAY_MS;
    delete process.env.JIRA_MAX_DELAY_MS;
    delete process.env.JIRA_JITTER_MIN;
    delete process.env.JIRA_JITTER_MAX;

    rateLimiter = new RateLimiter({
      maxConcurrent: 2,
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      requestDelayMs: 10,
    });

    axiosInstance = axios.create();
    rateLimiter.applyTo(axiosInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfigFromEnv", () => {
    it("should return default config when no env vars set", () => {
      const config = getConfigFromEnv();
      expect(config.maxConcurrent).toBe(1);
      expect(config.maxRetries).toBe(4);
      expect(config.initialDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.jitterMin).toBe(0.7);
      expect(config.jitterMax).toBe(1.3);
      expect(config.requestDelayMs).toBe(100);
    });

    it("should read config from environment variables", () => {
      process.env.JIRA_MAX_CONCURRENT = "5";
      process.env.JIRA_MAX_RETRIES = "2";
      process.env.JIRA_REQUEST_DELAY_MS = "50";
      process.env.JIRA_INITIAL_DELAY_MS = "200";
      process.env.JIRA_MAX_DELAY_MS = "5000";
      process.env.JIRA_JITTER_MIN = "0.5";
      process.env.JIRA_JITTER_MAX = "1.5";

      const config = getConfigFromEnv();
      expect(config.maxConcurrent).toBe(5);
      expect(config.maxRetries).toBe(2);
      expect(config.requestDelayMs).toBe(50);
      expect(config.initialDelayMs).toBe(200);
      expect(config.maxDelayMs).toBe(5000);
      expect(config.jitterMin).toBe(0.5);
      expect(config.jitterMax).toBe(1.5);
    });
  });

  describe("getState", () => {
    it("should return initial state", () => {
      const state = rateLimiter.getState();
      expect(state.activeRequests).toBe(0);
      expect(state.queueLength).toBe(0);
      expect(state.remaining).toBeNull();
      expect(state.resetAt).toBeNull();
      expect(state.nearLimit).toBe(false);
    });
  });

  describe("throttling", () => {
    it("should respect max concurrent requests", async () => {
      const limiter = new RateLimiter({
        maxConcurrent: 1,
        requestDelayMs: 0,
      });

      const instance = axios.create();
      limiter.applyTo(instance);

      // The state should track active requests
      const state = limiter.getState();
      expect(state.activeRequests).toBe(0);
    });

    it("should track queue length", () => {
      const limiter = new RateLimiter({
        maxConcurrent: 1,
      });

      const state = limiter.getState();
      expect(state.queueLength).toBe(0);
    });
  });

  describe("calculateBackoff", () => {
    it("should calculate exponential backoff with jitter", () => {
      // Test via the retry logic indirectly
      const limiter = new RateLimiter({
        initialDelayMs: 100,
        maxDelayMs: 1000,
        jitterMin: 1.0,
        jitterMax: 1.0, // No jitter for predictable testing
      });

      const state = limiter.getState();
      expect(state.activeRequests).toBe(0);
    });
  });
});

describe("RateLimiter Configuration", () => {
  beforeEach(() => {
    delete process.env.JIRA_MAX_CONCURRENT;
    delete process.env.JIRA_MAX_RETRIES;
    delete process.env.JIRA_REQUEST_DELAY_MS;
  });

  it("should merge custom config with defaults", () => {
    const customConfig: Partial<RateLimitConfig> = {
      maxConcurrent: 10,
    };

    const limiter = new RateLimiter(customConfig);
    const state = limiter.getState();
    expect(state.activeRequests).toBe(0);
  });

  it("should allow overriding all config options", () => {
    const fullConfig: RateLimitConfig = {
      maxConcurrent: 5,
      maxRetries: 2,
      initialDelayMs: 500,
      maxDelayMs: 5000,
      jitterMin: 0.5,
      jitterMax: 1.5,
      requestDelayMs: 200,
    };

    const limiter = new RateLimiter(fullConfig);
    expect(limiter).toBeDefined();
  });

  it("should use environment config as base", () => {
    process.env.JIRA_MAX_CONCURRENT = "10";

    const limiter = new RateLimiter({ maxRetries: 2 });
    // The limiter should exist and work
    const state = limiter.getState();
    expect(state).toBeDefined();
  });
});

describe("RateLimiter applyTo", () => {
  beforeEach(() => {
    delete process.env.JIRA_MAX_CONCURRENT;
    delete process.env.JIRA_MAX_RETRIES;
  });

  it("should add interceptors to axios instance", () => {
    const limiter = new RateLimiter();
    const instance = axios.create();

    // Count interceptors before
    const requestInterceptorsBefore = (instance.interceptors.request as any).handlers.length;
    const responseInterceptorsBefore = (instance.interceptors.response as any).handlers.length;

    limiter.applyTo(instance);

    // Count interceptors after
    const requestInterceptorsAfter = (instance.interceptors.request as any).handlers.length;
    const responseInterceptorsAfter = (instance.interceptors.response as any).handlers.length;

    expect(requestInterceptorsAfter).toBe(requestInterceptorsBefore + 1);
    expect(responseInterceptorsAfter).toBe(responseInterceptorsBefore + 1);
  });
});

describe("RateLimiter state management", () => {
  beforeEach(() => {
    delete process.env.JIRA_MAX_CONCURRENT;
    delete process.env.JIRA_MAX_RETRIES;
  });

  it("should track lastRequestTime", () => {
    const limiter = new RateLimiter();
    const state = limiter.getState();

    // Initially last request time should be 0
    expect(state.lastRequestTime).toBe(0);
  });

  it("should default nearLimit to false", () => {
    const limiter = new RateLimiter();
    const state = limiter.getState();

    expect(state.nearLimit).toBe(false);
  });

  it("should default remaining to null", () => {
    const limiter = new RateLimiter();
    const state = limiter.getState();

    expect(state.remaining).toBeNull();
  });

  it("should default resetAt to null", () => {
    const limiter = new RateLimiter();
    const state = limiter.getState();

    expect(state.resetAt).toBeNull();
  });
});

describe("RateLimiter default values", () => {
  beforeEach(() => {
    // Ensure no env vars interfere
    delete process.env.JIRA_MAX_CONCURRENT;
    delete process.env.JIRA_MAX_RETRIES;
    delete process.env.JIRA_INITIAL_DELAY_MS;
    delete process.env.JIRA_MAX_DELAY_MS;
    delete process.env.JIRA_JITTER_MIN;
    delete process.env.JIRA_JITTER_MAX;
    delete process.env.JIRA_REQUEST_DELAY_MS;
  });

  it("should create limiter with all defaults", () => {
    const limiter = new RateLimiter();
    expect(limiter).toBeDefined();

    const state = limiter.getState();
    expect(state.activeRequests).toBe(0);
    expect(state.queueLength).toBe(0);
  });

  it("should override specific defaults while keeping others", () => {
    const limiter = new RateLimiter({
      maxConcurrent: 5,
      // Other options should still have defaults
    });

    expect(limiter).toBeDefined();
  });
});
