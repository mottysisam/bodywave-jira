/**
 * Operation Verifier for Jira API
 *
 * Implements:
 * - Post-operation verification (re-fetch to confirm)
 * - Assertion helpers for expected values
 * - Bulk operation result summaries
 * - Detailed success/failure reporting
 */

export interface VerificationResult {
  success: boolean;
  operation: string;
  target: string;
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

export interface BulkOperationResult {
  operation: string;
  total: number;
  succeeded: number;
  failed: number;
  results: VerificationResult[];
  duration: number;
  summary: string;
}

export interface VerificationConfig {
  enabled: boolean;           // Enable verification (default: true)
  retryOnMismatch: boolean;   // Retry if verification fails (default: false)
  delayBeforeVerify: number;  // Delay before verification in ms (default: 500)
  maxVerifyRetries: number;   // Max verification retries (default: 3)
}

const DEFAULT_CONFIG: VerificationConfig = {
  enabled: true,
  retryOnMismatch: false,
  delayBeforeVerify: 500,
  maxVerifyRetries: 3,
};

export function getVerificationConfigFromEnv(): VerificationConfig {
  return {
    enabled: process.env.JIRA_VERIFY_ENABLED !== "false",
    retryOnMismatch: process.env.JIRA_VERIFY_RETRY === "true",
    delayBeforeVerify: parseInt(process.env.JIRA_VERIFY_DELAY_MS || "500", 10),
    maxVerifyRetries: parseInt(process.env.JIRA_VERIFY_MAX_RETRIES || "3", 10),
  };
}

/**
 * Helper to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deep comparison of two values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keysA = Object.keys(aObj);
    const keysB = Object.keys(bObj);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

export class OperationVerifier {
  private config: VerificationConfig;

  constructor(config?: Partial<VerificationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...getVerificationConfigFromEnv(), ...config };
  }

  /**
   * Verify a single operation by checking expected vs actual values
   */
  public async verify<T>(
    operation: string,
    target: string,
    fetchActual: () => Promise<T>,
    assertions: Partial<T> | ((actual: T) => boolean),
  ): Promise<VerificationResult> {
    if (!this.config.enabled) {
      return {
        success: true,
        operation,
        target,
        timestamp: new Date().toISOString(),
      };
    }

    // Delay before verification to allow Jira indexing
    await delay(this.config.delayBeforeVerify);

    let lastError: string | undefined;
    let actual: T | undefined;

    for (let attempt = 0; attempt < this.config.maxVerifyRetries; attempt++) {
      try {
        actual = await fetchActual();

        // Custom assertion function
        if (typeof assertions === "function") {
          const passed = assertions(actual);
          if (passed) {
            return {
              success: true,
              operation,
              target,
              actual: actual as unknown as Record<string, unknown>,
              timestamp: new Date().toISOString(),
            };
          }
          lastError = "Custom assertion failed";
        } else {
          // Object comparison
          const expected = assertions as Record<string, unknown>;
          const actualRecord = actual as unknown as Record<string, unknown>;
          const mismatches: string[] = [];

          for (const [key, expectedValue] of Object.entries(expected)) {
            const actualValue = actualRecord[key];
            if (!deepEqual(expectedValue, actualValue)) {
              mismatches.push(`${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
            }
          }

          if (mismatches.length === 0) {
            return {
              success: true,
              operation,
              target,
              expected,
              actual: actualRecord,
              timestamp: new Date().toISOString(),
            };
          }
          lastError = `Mismatches: ${mismatches.join("; ")}`;
        }

        // If we get here, verification failed but we might retry
        if (attempt < this.config.maxVerifyRetries - 1) {
          await delay(this.config.delayBeforeVerify * (attempt + 1));
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < this.config.maxVerifyRetries - 1) {
          await delay(this.config.delayBeforeVerify * (attempt + 1));
        }
      }
    }

    return {
      success: false,
      operation,
      target,
      expected: typeof assertions === "object" ? assertions as Record<string, unknown> : undefined,
      actual: actual as unknown as Record<string, unknown>,
      error: lastError,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verify issue creation
   */
  public async verifyIssueCreated(
    issueKey: string,
    fetchIssue: () => Promise<{ key: string; summary: string; status: string }>,
    expectedSummary: string,
  ): Promise<VerificationResult> {
    return this.verify(
      "createIssue",
      issueKey,
      fetchIssue,
      (issue) => issue.key === issueKey && issue.summary === expectedSummary,
    );
  }

  /**
   * Verify issue update
   */
  public async verifyIssueUpdated<T extends Record<string, unknown>>(
    issueKey: string,
    fetchIssue: () => Promise<T>,
    expectedChanges: Partial<T>,
  ): Promise<VerificationResult> {
    return this.verify("updateIssue", issueKey, fetchIssue, expectedChanges);
  }

  /**
   * Verify sprint state change
   */
  public async verifySprintState(
    sprintId: number,
    fetchSprint: () => Promise<{ id: number; state: string }>,
    expectedState: string,
  ): Promise<VerificationResult> {
    return this.verify(
      "updateSprintState",
      `sprint-${sprintId}`,
      fetchSprint,
      { state: expectedState },
    );
  }

  /**
   * Verify issues moved to sprint
   */
  public async verifyIssuesInSprint(
    sprintId: number,
    issueKeys: string[],
    fetchSprintIssues: () => Promise<Array<{ key: string }>>,
  ): Promise<VerificationResult> {
    return this.verify(
      "moveIssuesToSprint",
      `sprint-${sprintId}`,
      fetchSprintIssues,
      (issues) => {
        const sprintIssueKeys = new Set(issues.map(i => i.key));
        return issueKeys.every(key => sprintIssueKeys.has(key));
      },
    );
  }

  /**
   * Run bulk operations with verification and return summary
   */
  public async runBulkOperation<T, R>(
    operation: string,
    items: T[],
    execute: (item: T) => Promise<R>,
    verify?: (item: T, result: R) => Promise<VerificationResult>,
  ): Promise<BulkOperationResult> {
    const startTime = Date.now();
    const results: VerificationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      const itemId = typeof item === "object" && item !== null
        ? (item as Record<string, unknown>).key || (item as Record<string, unknown>).id || JSON.stringify(item)
        : String(item);

      try {
        const result = await execute(item);

        if (verify) {
          const verification = await verify(item, result);
          results.push(verification);
          if (verification.success) {
            succeeded++;
          } else {
            failed++;
          }
        } else {
          // No verification, assume success
          results.push({
            success: true,
            operation,
            target: String(itemId),
            timestamp: new Date().toISOString(),
          });
          succeeded++;
        }
      } catch (error) {
        failed++;
        results.push({
          success: false,
          operation,
          target: String(itemId),
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
      }
    }

    const duration = Date.now() - startTime;
    const successRate = items.length > 0 ? Math.round((succeeded / items.length) * 100) : 100;

    return {
      operation,
      total: items.length,
      succeeded,
      failed,
      results,
      duration,
      summary: `${operation}: ${succeeded}/${items.length} succeeded (${successRate}%) in ${duration}ms`,
    };
  }

  /**
   * Create a formatted report from bulk operation results
   */
  public formatReport(results: BulkOperationResult[]): string {
    const lines: string[] = [
      "=".repeat(60),
      "OPERATION VERIFICATION REPORT",
      "=".repeat(60),
      "",
    ];

    let totalSucceeded = 0;
    let totalFailed = 0;

    for (const result of results) {
      lines.push(`## ${result.operation}`);
      lines.push(result.summary);
      lines.push("");

      totalSucceeded += result.succeeded;
      totalFailed += result.failed;

      // Show failed operations
      const failures = result.results.filter(r => !r.success);
      if (failures.length > 0) {
        lines.push("Failed operations:");
        for (const failure of failures) {
          lines.push(`  - ${failure.target}: ${failure.error}`);
        }
        lines.push("");
      }
    }

    lines.push("-".repeat(60));
    lines.push(`TOTAL: ${totalSucceeded} succeeded, ${totalFailed} failed`);
    lines.push("=".repeat(60));

    return lines.join("\n");
  }
}
