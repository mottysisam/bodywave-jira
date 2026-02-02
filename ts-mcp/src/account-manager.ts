/**
 * Multi-Account Manager for Jira MCP Server
 *
 * Manages multiple Jira and Confluence account configurations with:
 * - Runtime account switching
 * - Secure credential storage (in-memory)
 * - Account listing and selection
 */

import { JiraConfig } from "./types.js";
import { JiraClient, JiraClientError } from "./jira-client.js";
import { ConfluenceClient } from "./confluence-client.js";

export interface JiraAccount {
  id: string;           // Unique identifier (e.g., "mycompany", "secondary")
  name: string;         // Display name
  url: string;          // Jira instance URL
  email: string;        // User email
  isActive: boolean;    // Currently active account
  addedAt: string;      // ISO timestamp when added
}

export interface AccountCredentials {
  email: string;
  apiKey: string;
}

export class AccountManager {
  private accounts: Map<string, JiraAccount> = new Map();
  private credentials: Map<string, AccountCredentials> = new Map();
  private activeAccountId: string | null = null;
  private clients: Map<string, JiraClient> = new Map();
  private confluenceClients: Map<string, ConfluenceClient> = new Map();

  constructor() {
    // Initialize with default account from environment if available
    this.initFromEnv();
  }

  /**
   * Initialize default account from environment variables
   */
  private initFromEnv(): void {
    const url = process.env.JIRA_URL;
    const email = process.env.JIRA_EMAIL;
    const apiKey = process.env.JIRA_API_KEY;

    if (url && email && apiKey) {
      // Extract domain name for ID (e.g., "mycompany" from "https://mycompany.atlassian.net")
      const urlMatch = url.match(/https?:\/\/([^.]+)\./);
      const id = urlMatch ? urlMatch[1] : "default";

      this.addAccount({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        url,
        email,
        apiKey,
      });

      this.setActiveAccount(id);
    }
  }

  /**
   * Add a new Jira account
   */
  addAccount(config: {
    id: string;
    name: string;
    url: string;
    email: string;
    apiKey: string;
  }): JiraAccount {
    const { id, name, url, email, apiKey } = config;

    // Validate ID format
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new JiraClientError(
        "Account ID must contain only lowercase letters, numbers, and hyphens"
      );
    }

    // Check for duplicate
    if (this.accounts.has(id)) {
      throw new JiraClientError(`Account '${id}' already exists`);
    }

    // Store account info (without sensitive data)
    const account: JiraAccount = {
      id,
      name,
      url: url.replace(/\/$/, ""), // Remove trailing slash
      email,
      isActive: false,
      addedAt: new Date().toISOString(),
    };

    this.accounts.set(id, account);

    // Store credentials separately (in-memory only)
    this.credentials.set(id, { email, apiKey });

    // Create JiraClient for this account
    const client = new JiraClient({
      url: account.url,
      email,
      apiKey,
    });
    this.clients.set(id, client);

    // Create ConfluenceClient for this account (same credentials, different base URL)
    const confluenceClient = new ConfluenceClient({
      baseUrl: `${account.url}/wiki/api/v2`,
      v1BaseUrl: `${account.url}/wiki/rest/api`,
      email,
      apiKey,
    });
    this.confluenceClients.set(id, confluenceClient);

    // If this is the first account, make it active
    if (this.accounts.size === 1) {
      this.setActiveAccount(id);
    }

    return account;
  }

  /**
   * Remove a Jira account
   */
  removeAccount(id: string): boolean {
    if (!this.accounts.has(id)) {
      return false;
    }

    // Can't remove the active account if it's the only one
    if (this.activeAccountId === id && this.accounts.size === 1) {
      throw new JiraClientError("Cannot remove the only configured account");
    }

    // If removing active account, switch to another
    if (this.activeAccountId === id) {
      const otherAccount = Array.from(this.accounts.keys()).find(k => k !== id);
      if (otherAccount) {
        this.setActiveAccount(otherAccount);
      }
    }

    this.accounts.delete(id);
    this.credentials.delete(id);
    this.clients.delete(id);
    this.confluenceClients.delete(id);

    return true;
  }

  /**
   * Set the active account
   */
  setActiveAccount(id: string): JiraAccount {
    const account = this.accounts.get(id);
    if (!account) {
      throw new JiraClientError(`Account '${id}' not found`);
    }

    // Update active status
    for (const [accountId, acc] of this.accounts) {
      acc.isActive = accountId === id;
    }

    this.activeAccountId = id;
    return account;
  }

  /**
   * Get the active account
   */
  getActiveAccount(): JiraAccount | null {
    if (!this.activeAccountId) return null;
    return this.accounts.get(this.activeAccountId) || null;
  }

  /**
   * Get the active JiraClient
   */
  getActiveClient(): JiraClient {
    if (!this.activeAccountId) {
      throw new JiraClientError("No active account configured");
    }

    const client = this.clients.get(this.activeAccountId);
    if (!client) {
      throw new JiraClientError("Client not found for active account");
    }

    return client;
  }

  /**
   * Get JiraClient for specific account
   */
  getClient(id: string): JiraClient {
    const client = this.clients.get(id);
    if (!client) {
      throw new JiraClientError(`Account '${id}' not found`);
    }
    return client;
  }

  /**
   * Get the active ConfluenceClient
   */
  getActiveConfluenceClient(): ConfluenceClient {
    if (!this.activeAccountId) {
      throw new JiraClientError("No active account configured");
    }

    const client = this.confluenceClients.get(this.activeAccountId);
    if (!client) {
      throw new JiraClientError("Confluence client not found for active account");
    }

    return client;
  }

  /**
   * Get ConfluenceClient for specific account
   */
  getConfluenceClient(id: string): ConfluenceClient {
    const client = this.confluenceClients.get(id);
    if (!client) {
      throw new JiraClientError(`Account '${id}' not found`);
    }
    return client;
  }

  /**
   * List all configured accounts
   */
  listAccounts(): JiraAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * Get account by ID
   */
  getAccount(id: string): JiraAccount | undefined {
    return this.accounts.get(id);
  }

  /**
   * Check if any accounts are configured
   */
  hasAccounts(): boolean {
    return this.accounts.size > 0;
  }

  /**
   * Get account count
   */
  getAccountCount(): number {
    return this.accounts.size;
  }

  /**
   * Test connection for an account
   */
  async testConnection(id: string): Promise<{ success: boolean; user?: string; error?: string }> {
    try {
      const client = this.getClient(id);
      const user = await client.getCurrentUser();
      return {
        success: true,
        user: user.displayName,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Singleton instance for the MCP server
export const accountManager = new AccountManager();
