import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  OperationVerifier,
  VerificationResult,
  BulkOperationResult,
  getVerificationConfigFromEnv,
} from "../src/operation-verifier.js";

describe("OperationVerifier", () => {
  let verifier: OperationVerifier;

  beforeEach(() => {
    delete process.env.JIRA_VERIFY_ENABLED;
    delete process.env.JIRA_VERIFY_RETRY;
    delete process.env.JIRA_VERIFY_DELAY_MS;

    verifier = new OperationVerifier({
      enabled: true,
      retryOnMismatch: false,
      delayBeforeVerify: 10, // Short delay for tests
      maxVerifyRetries: 2,
    });
  });

  describe("getVerificationConfigFromEnv", () => {
    it("should return defaults when no env vars set", () => {
      const config = getVerificationConfigFromEnv();
      expect(config.enabled).toBe(true);
      expect(config.retryOnMismatch).toBe(false);
      expect(config.delayBeforeVerify).toBe(500);
      expect(config.maxVerifyRetries).toBe(3);
    });

    it("should read config from environment", () => {
      process.env.JIRA_VERIFY_ENABLED = "false";
      process.env.JIRA_VERIFY_RETRY = "true";
      process.env.JIRA_VERIFY_DELAY_MS = "200";

      const config = getVerificationConfigFromEnv();
      expect(config.enabled).toBe(false);
      expect(config.retryOnMismatch).toBe(true);
      expect(config.delayBeforeVerify).toBe(200);
    });
  });

  describe("verify", () => {
    it("should return success when verification is disabled", async () => {
      const disabledVerifier = new OperationVerifier({
        enabled: false,
      });

      const result = await disabledVerifier.verify(
        "test",
        "target",
        async () => ({ value: "wrong" }),
        { value: "expected" }
      );

      expect(result.success).toBe(true);
    });

    it("should verify with object assertions", async () => {
      const result = await verifier.verify(
        "createIssue",
        "TEST-123",
        async () => ({ key: "TEST-123", summary: "Test Issue" }),
        { key: "TEST-123", summary: "Test Issue" }
      );

      expect(result.success).toBe(true);
      expect(result.operation).toBe("createIssue");
      expect(result.target).toBe("TEST-123");
    });

    it("should fail verification when values don't match", async () => {
      const result = await verifier.verify(
        "createIssue",
        "TEST-123",
        async () => ({ key: "TEST-123", summary: "Different Summary" }),
        { key: "TEST-123", summary: "Expected Summary" }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Mismatches");
    });

    it("should verify with custom assertion function", async () => {
      const result = await verifier.verify(
        "updateIssue",
        "TEST-123",
        async () => ({ key: "TEST-123", status: "Done" }),
        (actual) => actual.status === "Done"
      );

      expect(result.success).toBe(true);
    });

    it("should fail with custom assertion that returns false", async () => {
      const result = await verifier.verify(
        "updateIssue",
        "TEST-123",
        async () => ({ key: "TEST-123", status: "To Do" }),
        (actual) => actual.status === "Done"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Custom assertion failed");
    });

    it("should handle errors during fetch", async () => {
      const result = await verifier.verify(
        "getIssue",
        "TEST-123",
        async () => {
          throw new Error("Network error");
        },
        { key: "TEST-123" }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("should retry on failure before giving up", async () => {
      let attempts = 0;
      const result = await verifier.verify(
        "updateIssue",
        "TEST-123",
        async () => {
          attempts++;
          return { key: "TEST-123", status: attempts >= 2 ? "Done" : "In Progress" };
        },
        { status: "Done" }
      );

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });
  });

  describe("verifyIssueCreated", () => {
    it("should verify issue was created", async () => {
      const result = await verifier.verifyIssueCreated(
        "TEST-123",
        async () => ({ key: "TEST-123", summary: "New Issue", status: "To Do" }),
        "New Issue"
      );

      expect(result.success).toBe(true);
    });

    it("should fail when summary doesn't match", async () => {
      const result = await verifier.verifyIssueCreated(
        "TEST-123",
        async () => ({ key: "TEST-123", summary: "Wrong Summary", status: "To Do" }),
        "Expected Summary"
      );

      expect(result.success).toBe(false);
    });
  });

  describe("verifyIssueUpdated", () => {
    it("should verify issue was updated", async () => {
      const result = await verifier.verifyIssueUpdated(
        "TEST-123",
        async () => ({ key: "TEST-123", summary: "Updated Summary", priority: "High" }),
        { summary: "Updated Summary" }
      );

      expect(result.success).toBe(true);
    });
  });

  describe("verifySprintState", () => {
    it("should verify sprint state change", async () => {
      const result = await verifier.verifySprintState(
        42,
        async () => ({ id: 42, state: "active" }),
        "active"
      );

      expect(result.success).toBe(true);
      expect(result.target).toBe("sprint-42");
    });
  });

  describe("verifyIssuesInSprint", () => {
    it("should verify all issues are in sprint", async () => {
      const result = await verifier.verifyIssuesInSprint(
        42,
        ["TEST-1", "TEST-2", "TEST-3"],
        async () => [{ key: "TEST-1" }, { key: "TEST-2" }, { key: "TEST-3" }, { key: "TEST-4" }]
      );

      expect(result.success).toBe(true);
    });

    it("should fail when not all issues are in sprint", async () => {
      const result = await verifier.verifyIssuesInSprint(
        42,
        ["TEST-1", "TEST-2", "TEST-3"],
        async () => [{ key: "TEST-1" }, { key: "TEST-2" }]
      );

      expect(result.success).toBe(false);
    });
  });

  describe("runBulkOperation", () => {
    it("should run bulk operations without verification", async () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = await verifier.runBulkOperation(
        "bulkCreate",
        items,
        async (item) => ({ created: item.id })
      );

      expect(result.operation).toBe("bulkCreate");
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.summary).toContain("3/3 succeeded");
    });

    it("should run bulk operations with verification", async () => {
      const items = [{ id: 1 }, { id: 2 }];
      const result = await verifier.runBulkOperation(
        "bulkCreate",
        items,
        async (item) => ({ created: item.id }),
        async (item, res) => ({
          success: res.created === item.id,
          operation: "bulkCreate",
          target: `item-${item.id}`,
          timestamp: new Date().toISOString(),
        })
      );

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("should handle errors in bulk operations", async () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = await verifier.runBulkOperation(
        "bulkCreate",
        items,
        async (item) => {
          if (item.id === 2) {
            throw new Error("Item 2 failed");
          }
          return { created: item.id };
        }
      );

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
    });

    it("should calculate correct success rate", async () => {
      const items = [1, 2, 3, 4, 5];
      const result = await verifier.runBulkOperation(
        "test",
        items,
        async (item) => {
          if (item % 2 === 0) {
            throw new Error("Even numbers fail");
          }
          return item;
        }
      );

      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(2);
      expect(result.summary).toContain("60%");
    });
  });

  describe("formatReport", () => {
    it("should format a single operation report", () => {
      const results: BulkOperationResult[] = [
        {
          operation: "createIssues",
          total: 10,
          succeeded: 9,
          failed: 1,
          results: [
            {
              success: false,
              operation: "createIssues",
              target: "item-5",
              error: "Validation failed",
              timestamp: new Date().toISOString(),
            },
          ],
          duration: 1234,
          summary: "createIssues: 9/10 succeeded (90%) in 1234ms",
        },
      ];

      const report = verifier.formatReport(results);
      expect(report).toContain("OPERATION VERIFICATION REPORT");
      expect(report).toContain("createIssues");
      expect(report).toContain("9/10 succeeded");
      expect(report).toContain("Failed operations:");
      expect(report).toContain("item-5: Validation failed");
      expect(report).toContain("TOTAL: 9 succeeded, 1 failed");
    });

    it("should format multiple operation reports", () => {
      const results: BulkOperationResult[] = [
        {
          operation: "op1",
          total: 5,
          succeeded: 5,
          failed: 0,
          results: [],
          duration: 100,
          summary: "op1: 5/5 succeeded",
        },
        {
          operation: "op2",
          total: 3,
          succeeded: 2,
          failed: 1,
          results: [],
          duration: 200,
          summary: "op2: 2/3 succeeded",
        },
      ];

      const report = verifier.formatReport(results);
      expect(report).toContain("op1");
      expect(report).toContain("op2");
      expect(report).toContain("TOTAL: 7 succeeded, 1 failed");
    });
  });
});
