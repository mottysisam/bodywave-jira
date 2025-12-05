import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccountManager, JiraAccount } from "../src/account-manager.js";

// Mock JiraClient
vi.mock("../src/jira-client.js", () => ({
  JiraClient: vi.fn().mockImplementation(() => ({
    getCurrentUser: vi.fn().mockResolvedValue({
      displayName: "Test User",
      accountId: "test-account-id",
    }),
  })),
  JiraClientError: class JiraClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "JiraClientError";
    }
  },
}));

describe("AccountManager", () => {
  let manager: AccountManager;

  beforeEach(() => {
    // Clear environment variables for clean tests
    delete process.env.JIRA_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_KEY;
    manager = new AccountManager();
  });

  describe("constructor", () => {
    it("should initialize empty when no env vars are set", () => {
      expect(manager.hasAccounts()).toBe(false);
      expect(manager.getAccountCount()).toBe(0);
    });

    it("should initialize from environment variables", () => {
      process.env.JIRA_URL = "https://test.atlassian.net";
      process.env.JIRA_EMAIL = "test@example.com";
      process.env.JIRA_API_KEY = "test-api-key";

      const managerWithEnv = new AccountManager();
      expect(managerWithEnv.hasAccounts()).toBe(true);
      expect(managerWithEnv.getAccountCount()).toBe(1);
      expect(managerWithEnv.getActiveAccount()?.id).toBe("test");
    });
  });

  describe("addAccount", () => {
    it("should add a new account successfully", () => {
      const account = manager.addAccount({
        id: "test-account",
        name: "Test Account",
        url: "https://test.atlassian.net",
        email: "test@example.com",
        apiKey: "test-api-key",
      });

      expect(account.id).toBe("test-account");
      expect(account.name).toBe("Test Account");
      expect(account.url).toBe("https://test.atlassian.net");
      expect(account.email).toBe("test@example.com");
      expect(account.isActive).toBe(true); // First account becomes active
      expect(manager.getAccountCount()).toBe(1);
    });

    it("should strip trailing slash from URL", () => {
      const account = manager.addAccount({
        id: "test-account",
        name: "Test Account",
        url: "https://test.atlassian.net/",
        email: "test@example.com",
        apiKey: "test-api-key",
      });

      expect(account.url).toBe("https://test.atlassian.net");
    });

    it("should throw error for invalid account ID", () => {
      expect(() => {
        manager.addAccount({
          id: "Invalid ID!",
          name: "Test Account",
          url: "https://test.atlassian.net",
          email: "test@example.com",
          apiKey: "test-api-key",
        });
      }).toThrow("Account ID must contain only lowercase letters, numbers, and hyphens");
    });

    it("should throw error for duplicate account ID", () => {
      manager.addAccount({
        id: "test-account",
        name: "Test Account",
        url: "https://test.atlassian.net",
        email: "test@example.com",
        apiKey: "test-api-key",
      });

      expect(() => {
        manager.addAccount({
          id: "test-account",
          name: "Another Account",
          url: "https://test2.atlassian.net",
          email: "test2@example.com",
          apiKey: "test-api-key-2",
        });
      }).toThrow("Account 'test-account' already exists");
    });

    it("should make first account active automatically", () => {
      const account1 = manager.addAccount({
        id: "account-1",
        name: "Account 1",
        url: "https://test1.atlassian.net",
        email: "test1@example.com",
        apiKey: "key1",
      });

      const account2 = manager.addAccount({
        id: "account-2",
        name: "Account 2",
        url: "https://test2.atlassian.net",
        email: "test2@example.com",
        apiKey: "key2",
      });

      expect(account1.isActive).toBe(true);
      expect(account2.isActive).toBe(false);
      expect(manager.getActiveAccount()?.id).toBe("account-1");
    });
  });

  describe("removeAccount", () => {
    beforeEach(() => {
      manager.addAccount({
        id: "account-1",
        name: "Account 1",
        url: "https://test1.atlassian.net",
        email: "test1@example.com",
        apiKey: "key1",
      });
      manager.addAccount({
        id: "account-2",
        name: "Account 2",
        url: "https://test2.atlassian.net",
        email: "test2@example.com",
        apiKey: "key2",
      });
    });

    it("should remove an account successfully", () => {
      const result = manager.removeAccount("account-2");
      expect(result).toBe(true);
      expect(manager.getAccountCount()).toBe(1);
      expect(manager.getAccount("account-2")).toBeUndefined();
    });

    it("should return false for non-existent account", () => {
      const result = manager.removeAccount("non-existent");
      expect(result).toBe(false);
    });

    it("should switch to another account when removing active account", () => {
      expect(manager.getActiveAccount()?.id).toBe("account-1");
      manager.removeAccount("account-1");
      expect(manager.getActiveAccount()?.id).toBe("account-2");
    });

    it("should throw error when removing the only account", () => {
      manager.removeAccount("account-2");
      expect(() => {
        manager.removeAccount("account-1");
      }).toThrow("Cannot remove the only configured account");
    });
  });

  describe("setActiveAccount", () => {
    beforeEach(() => {
      manager.addAccount({
        id: "account-1",
        name: "Account 1",
        url: "https://test1.atlassian.net",
        email: "test1@example.com",
        apiKey: "key1",
      });
      manager.addAccount({
        id: "account-2",
        name: "Account 2",
        url: "https://test2.atlassian.net",
        email: "test2@example.com",
        apiKey: "key2",
      });
    });

    it("should switch active account", () => {
      expect(manager.getActiveAccount()?.id).toBe("account-1");
      const switched = manager.setActiveAccount("account-2");
      expect(switched.id).toBe("account-2");
      expect(manager.getActiveAccount()?.id).toBe("account-2");
    });

    it("should update isActive flags", () => {
      manager.setActiveAccount("account-2");
      const accounts = manager.listAccounts();
      const account1 = accounts.find((a) => a.id === "account-1");
      const account2 = accounts.find((a) => a.id === "account-2");
      expect(account1?.isActive).toBe(false);
      expect(account2?.isActive).toBe(true);
    });

    it("should throw error for non-existent account", () => {
      expect(() => {
        manager.setActiveAccount("non-existent");
      }).toThrow("Account 'non-existent' not found");
    });
  });

  describe("getActiveClient", () => {
    it("should throw error when no active account", () => {
      expect(() => {
        manager.getActiveClient();
      }).toThrow("No active account configured");
    });

    it("should return client for active account", () => {
      manager.addAccount({
        id: "test-account",
        name: "Test Account",
        url: "https://test.atlassian.net",
        email: "test@example.com",
        apiKey: "test-api-key",
      });

      const client = manager.getActiveClient();
      expect(client).toBeDefined();
    });
  });

  describe("getClient", () => {
    it("should return client for specific account", () => {
      manager.addAccount({
        id: "test-account",
        name: "Test Account",
        url: "https://test.atlassian.net",
        email: "test@example.com",
        apiKey: "test-api-key",
      });

      const client = manager.getClient("test-account");
      expect(client).toBeDefined();
    });

    it("should throw error for non-existent account", () => {
      expect(() => {
        manager.getClient("non-existent");
      }).toThrow("Account 'non-existent' not found");
    });
  });

  describe("listAccounts", () => {
    it("should return empty array when no accounts", () => {
      expect(manager.listAccounts()).toEqual([]);
    });

    it("should return all accounts", () => {
      manager.addAccount({
        id: "account-1",
        name: "Account 1",
        url: "https://test1.atlassian.net",
        email: "test1@example.com",
        apiKey: "key1",
      });
      manager.addAccount({
        id: "account-2",
        name: "Account 2",
        url: "https://test2.atlassian.net",
        email: "test2@example.com",
        apiKey: "key2",
      });

      const accounts = manager.listAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts.map((a) => a.id)).toEqual(["account-1", "account-2"]);
    });
  });

  describe("testConnection", () => {
    it("should return success when connection works", async () => {
      manager.addAccount({
        id: "test-account",
        name: "Test Account",
        url: "https://test.atlassian.net",
        email: "test@example.com",
        apiKey: "test-api-key",
      });

      const result = await manager.testConnection("test-account");
      expect(result.success).toBe(true);
      expect(result.user).toBe("Test User");
    });

    it("should return failure for non-existent account", async () => {
      const result = await manager.testConnection("non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
