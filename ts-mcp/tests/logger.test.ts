import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Logger, LogLevel, getLoggerConfigFromEnv } from "../src/logger.js";

describe("Logger", () => {
  let logger: Logger;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.JIRA_LOG_LEVEL;
    logger = new Logger({ level: LogLevel.DEBUG });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("getLoggerConfigFromEnv", () => {
    it("should return INFO by default", () => {
      const config = getLoggerConfigFromEnv();
      expect(config.level).toBe(LogLevel.INFO);
    });

    it("should parse DEBUG level", () => {
      process.env.JIRA_LOG_LEVEL = "DEBUG";
      const config = getLoggerConfigFromEnv();
      expect(config.level).toBe(LogLevel.DEBUG);
    });

    it("should parse WARN level", () => {
      process.env.JIRA_LOG_LEVEL = "WARN";
      const config = getLoggerConfigFromEnv();
      expect(config.level).toBe(LogLevel.WARN);
    });

    it("should parse ERROR level", () => {
      process.env.JIRA_LOG_LEVEL = "ERROR";
      const config = getLoggerConfigFromEnv();
      expect(config.level).toBe(LogLevel.ERROR);
    });

    it("should be case insensitive", () => {
      process.env.JIRA_LOG_LEVEL = "debug";
      const config = getLoggerConfigFromEnv();
      expect(config.level).toBe(LogLevel.DEBUG);
    });
  });

  describe("logging methods", () => {
    it("should log debug messages when level is DEBUG", () => {
      logger.debug("test message", { operation: "test" });
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("DEBUG");
      expect(output).toContain("test message");
    });

    it("should not log debug messages when level is INFO", () => {
      const infoLogger = new Logger({ level: LogLevel.INFO });
      infoLogger.debug("test message");
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("should log info messages", () => {
      logger.info("info message", { operation: "test" });
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("INFO");
      expect(output).toContain("info message");
    });

    it("should log warn messages", () => {
      logger.warn("warning message");
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("WARN");
    });

    it("should log error messages", () => {
      logger.error("error message", { operation: "test" });
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("ERROR");
    });

    it("should always log errors regardless of level", () => {
      const errorLogger = new Logger({ level: LogLevel.ERROR });
      errorLogger.error("error message");
      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  describe("request/response logging", () => {
    it("should log requests", () => {
      logger.request("GET", "/api/v3/issue/TEST-123");
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("GET");
      expect(output).toContain("/api/v3/issue/TEST-123");
    });

    it("should log responses with duration", () => {
      logger.response("GET", "/api/v3/issue/TEST-123", 200, 150);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("200");
      expect(output).toContain("150");
    });
  });

  describe("metrics tracking", () => {
    it("should track request metrics", () => {
      logger.response("GET", "/api/v3/issue/TEST-1", 200, 100);
      logger.response("GET", "/api/v3/issue/TEST-2", 200, 200);
      logger.response("POST", "/api/v3/issue", 201, 300);

      const metrics = logger.getMetricsSummary();
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.successfulRequests).toBe(3);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.averageDurationMs).toBe(200);
    });

    it("should track failed requests", () => {
      logger.response("GET", "/api/v3/issue/TEST-1", 200, 100);
      logger.response("GET", "/api/v3/issue/TEST-2", 404, 50);
      logger.response("POST", "/api/v3/issue", 500, 200);

      const metrics = logger.getMetricsSummary();
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.successfulRequests).toBe(1);
      expect(metrics.failedRequests).toBe(2);
    });

    it("should track top endpoints", () => {
      logger.response("GET", "/api/v3/issue/TEST-1", 200, 100);
      logger.response("GET", "/api/v3/issue/TEST-2", 200, 100);
      logger.response("GET", "/api/v3/issue/TEST-3", 200, 100);
      logger.response("POST", "/api/v3/issue", 201, 100);

      const metrics = logger.getMetricsSummary();
      expect(metrics.topEndpoints).toBeDefined();
      expect((metrics.topEndpoints as Array<unknown>).length).toBeGreaterThan(0);
    });

    it("should track error types", () => {
      logger.response("GET", "/api/v3/issue/BAD", 400, 50);
      logger.response("GET", "/api/v3/issue/MISSING", 404, 50);
      logger.response("POST", "/api/v3/issue", 500, 100);
      logger.response("POST", "/api/v3/issue", 500, 100);

      const metrics = logger.getMetricsSummary();
      const errorTypes = metrics.errorTypes as Record<string, number>;
      expect(errorTypes).toBeDefined();
      expect(errorTypes["HTTP_500"]).toBe(2);
      expect(errorTypes["HTTP_404"]).toBe(1);
      expect(errorTypes["HTTP_400"]).toBe(1);
    });

    it("should calculate correct success rate", () => {
      logger.response("GET", "/test", 200, 100);
      logger.response("GET", "/test", 200, 100);
      logger.response("GET", "/test", 200, 100);
      logger.response("GET", "/test", 500, 100);

      const metrics = logger.getMetricsSummary();
      expect(metrics.successRate).toBe(75);
    });

    it("should reset metrics", () => {
      logger.response("GET", "/test", 200, 100);
      logger.response("GET", "/test", 200, 100);

      let metrics = logger.getMetricsSummary();
      expect(metrics.totalRequests).toBe(2);

      logger.metrics.reset();

      metrics = logger.getMetricsSummary();
      expect(metrics.totalRequests).toBe(0);
    });
  });

  describe("child logger", () => {
    it("should create a child logger with context", () => {
      const child = logger.child({ operation: "test-op", target: "TEST-123" });
      child.info("child log message");

      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("child log message");
      expect(output).toContain("test-op");
    });
  });

  describe("setLevel", () => {
    it("should allow changing log level at runtime", () => {
      const testLogger = new Logger({ level: LogLevel.ERROR });

      // Debug should not be logged at ERROR level
      testLogger.debug("debug message");
      expect(stderrSpy).not.toHaveBeenCalled();

      // Change to DEBUG level
      testLogger.setLevel(LogLevel.DEBUG);

      // Now debug should be logged
      testLogger.debug("debug message after level change");
      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  describe("operation logging", () => {
    it("should log operation start and return requestId", () => {
      const requestId = logger.operationStart("createIssue", "TEST-123");
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe("string");
      expect(stderrSpy).toHaveBeenCalled();
    });

    it("should log operation end", () => {
      logger.operationEnd("createIssue", "TEST-123", 250, true);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("completed");
    });

    it("should log operation failure", () => {
      logger.operationEnd("createIssue", "TEST-123", 100, false);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("failed");
    });
  });
});
