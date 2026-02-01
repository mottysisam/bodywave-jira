/**
 * Jira REST API Client
 *
 * Reads configuration from environment variables:
 * - JIRA_URL: Jira instance URL (e.g., https://your-domain.atlassian.net)
 * - JIRA_EMAIL: User email for authentication
 * - JIRA_API_KEY: API token for authentication
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import {
  JiraConfig,
  Issue,
  Project,
  Sprint,
  Board,
  User,
  SearchResult,
  ProjectCreate,
  IssueCreate,
  IssueUpdate,
  SprintCreate,
  SprintUpdate,
  Comment,
  Transition,
  SprintState,
  CreateMeta,
  FieldConfiguration,
  FieldConfigurationItem,
  CustomField,
  CustomFieldOption,
  Worklog,
  WorklogCreate,
  TimeTracking,
  Attachment,
  Webhook,
  WebhookCreate,
  IssueLink,
  IssueLinkType,
  IssueLinkCreate,
  SprintReport,
  SprintVelocity,
  VelocityReport,
  SprintBurndown,
  BurndownPoint,
  JqlFilter,
  FilterCreate,
  FilterUpdate,
  FilterSharePermission,
} from "./types.js";
import { RateLimiter } from "./rate-limiter.js";
import { OperationVerifier, VerificationResult, BulkOperationResult } from "./operation-verifier.js";

// Re-export for external use
export { OperationVerifier, VerificationResult, BulkOperationResult };

export class JiraClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "JiraClientError";
  }
}

/**
 * Get Jira configuration from environment variables
 */
export function getConfigFromEnv(): JiraConfig {
  const url = process.env.JIRA_URL;
  const email = process.env.JIRA_EMAIL;
  const apiKey = process.env.JIRA_API_KEY;

  if (!url) {
    throw new JiraClientError("JIRA_URL environment variable is required");
  }
  if (!email) {
    throw new JiraClientError("JIRA_EMAIL environment variable is required");
  }
  if (!apiKey) {
    throw new JiraClientError("JIRA_API_KEY environment variable is required");
  }

  return { url, email, apiKey };
}

export class JiraClient {
  private client: AxiosInstance;
  private agileClient: AxiosInstance;
  private config: JiraConfig;
  private rateLimiter: RateLimiter;
  public verifier: OperationVerifier;

  constructor(config?: JiraConfig) {
    this.config = config ?? getConfigFromEnv();

    // Initialize rate limiter (shared across both clients)
    this.rateLimiter = new RateLimiter();

    // Initialize operation verifier
    this.verifier = new OperationVerifier();

    // Base64 encode email:apiKey for Basic auth
    const auth = Buffer.from(`${this.config.email}:${this.config.apiKey}`).toString("base64");

    // REST API v3 client
    this.client = axios.create({
      baseURL: `${this.config.url}/rest/api/3`,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Agile API client (for sprints, boards)
    this.agileClient = axios.create({
      baseURL: `${this.config.url}/rest/agile/1.0`,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Apply rate limiting to both clients
    this.rateLimiter.applyTo(this.client);
    this.rateLimiter.applyTo(this.agileClient);
  }

  private handleError(error: unknown): never {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const data = error.response?.data;
      throw new JiraClientError(
        data?.errorMessages?.join(", ") || error.message,
        status,
        data
      );
    }
    throw error;
  }

  // ==================== Issue Operations ====================

  async getIssue(issueKey: string): Promise<Issue> {
    try {
      const response = await this.client.get(`/issue/${issueKey}`);
      return this.parseIssue(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async createIssue(data: IssueCreate): Promise<Issue> {
    try {
      const payload = this.buildIssuePayload(data);
      const response = await this.client.post("/issue", payload);
      return this.getIssue(response.data.key);
    } catch (error) {
      this.handleError(error);
    }
  }

  async updateIssue(issueKey: string, data: IssueUpdate): Promise<Issue> {
    try {
      const payload = this.buildUpdatePayload(data);
      await this.client.put(`/issue/${issueKey}`, payload);
      return this.getIssue(issueKey);
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteIssue(issueKey: string): Promise<void> {
    try {
      await this.client.delete(`/issue/${issueKey}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  async searchIssues(jql: string, maxResults = 50, nextPageToken?: string): Promise<SearchResult> {
    try {
      const payload: Record<string, unknown> = {
        jql,
        maxResults,
        fields: [
          "summary", "description", "issuetype", "status", "priority",
          "project", "assignee", "reporter", "labels", "sprint",
          "created", "updated", "customfield_10016" // story points
        ],
      };
      if (nextPageToken) {
        payload.nextPageToken = nextPageToken;
      }

      const response = await this.client.post("/search/jql", payload);

      return {
        issues: response.data.issues.map((i: unknown) => this.parseIssue(i)),
        total: response.data.issues.length, // New API doesn't return total
        startAt: 0, // Deprecated in new API
        maxResults: response.data.maxResults || maxResults,
        nextPageToken: response.data.nextPageToken,
        isLast: response.data.isLast,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async addComment(issueKey: string, body: string): Promise<Comment> {
    try {
      const response = await this.client.post(`/issue/${issueKey}/comment`, {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: body }],
            },
          ],
        },
      });
      return this.parseComment(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get all comments for an issue
   */
  async getComments(issueKey: string, maxResults = 50, startAt = 0): Promise<{ comments: Comment[]; total: number; startAt: number; maxResults: number }> {
    try {
      const response = await this.client.get(`/issue/${issueKey}/comment`, {
        params: { startAt, maxResults },
      });
      return {
        comments: (response.data.comments || []).map((c: unknown) => this.parseComment(c)),
        total: response.data.total || 0,
        startAt: response.data.startAt || 0,
        maxResults: response.data.maxResults || maxResults,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific comment by ID
   */
  async getComment(issueKey: string, commentId: string): Promise<Comment> {
    try {
      const response = await this.client.get(`/issue/${issueKey}/comment/${commentId}`);
      return this.parseComment(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update an existing comment
   */
  async updateComment(issueKey: string, commentId: string, body: string): Promise<Comment> {
    try {
      const response = await this.client.put(`/issue/${issueKey}/comment/${commentId}`, {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: body }],
            },
          ],
        },
      });
      return this.parseComment(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete a comment
   */
  async deleteComment(issueKey: string, commentId: string): Promise<void> {
    try {
      await this.client.delete(`/issue/${issueKey}/comment/${commentId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTransitions(issueKey: string): Promise<Transition[]> {
    try {
      const response = await this.client.get(`/issue/${issueKey}/transitions`);
      return response.data.transitions;
    } catch (error) {
      this.handleError(error);
    }
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    try {
      await this.client.post(`/issue/${issueKey}/transitions`, {
        transition: { id: transitionId },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Project Operations ====================

  async getProject(projectKey: string): Promise<Project> {
    try {
      const response = await this.client.get(`/project/${projectKey}`);
      return this.parseProject(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async listProjects(): Promise<Project[]> {
    try {
      const response = await this.client.get("/project");
      return response.data.map((p: unknown) => this.parseProject(p));
    } catch (error) {
      this.handleError(error);
    }
  }

  async createProject(data: ProjectCreate): Promise<Project> {
    try {
      // Auto-fetch current user as lead if not provided
      let leadAccountId = data.leadAccountId;
      if (!leadAccountId) {
        const currentUser = await this.getCurrentUser();
        leadAccountId = currentUser.accountId;
      }

      const payload: Record<string, unknown> = {
        key: data.key.toUpperCase(),
        name: data.name,
        leadAccountId,
        projectTypeKey: data.projectTypeKey || "software",
        projectTemplateKey: data.projectTemplateKey || "com.pyxis.greenhopper.jira:gh-simplified-agility-scrum",
      };

      if (data.description) payload.description = data.description;

      const response = await this.client.post("/project", payload);
      return this.getProject(response.data.key);
    } catch (error) {
      this.handleError(error);
    }
  }

  async validateProjectKey(key: string): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      const response = await this.client.get(`/projectvalidate/key`, {
        params: { key: key.toUpperCase() },
      });
      return { valid: response.data === key.toUpperCase(), errors: [] };
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 404) {
        return { valid: true };
      }
      if (error instanceof AxiosError && error.response?.data?.errorMessages) {
        return { valid: false, errors: error.response.data.errorMessages };
      }
      this.handleError(error);
    }
  }

  async deleteProject(projectKeyOrId: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.client.delete(`/project/${projectKeyOrId}`);
      return { success: true, message: `Project ${projectKeyOrId} deleted successfully` };
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Sprint Operations ====================

  async getSprint(sprintId: number): Promise<Sprint> {
    try {
      const response = await this.agileClient.get(`/sprint/${sprintId}`);
      return this.parseSprint(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async createSprint(data: SprintCreate): Promise<Sprint> {
    try {
      const payload = {
        name: data.name,
        originBoardId: data.boardId,
        ...(data.startDate && { startDate: data.startDate }),
        ...(data.endDate && { endDate: data.endDate }),
        ...(data.goal && { goal: data.goal }),
      };
      const response = await this.agileClient.post("/sprint", payload);
      return this.parseSprint(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async updateSprint(sprintId: number, data: SprintUpdate): Promise<Sprint> {
    try {
      const payload: Record<string, unknown> = {};
      if (data.name) payload.name = data.name;
      if (data.startDate) payload.startDate = data.startDate;
      if (data.endDate) payload.endDate = data.endDate;
      if (data.goal !== undefined) payload.goal = data.goal;
      if (data.state) payload.state = data.state;

      await this.agileClient.put(`/sprint/${sprintId}`, payload);
      return this.getSprint(sprintId);
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteSprint(sprintId: number): Promise<void> {
    try {
      await this.agileClient.delete(`/sprint/${sprintId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  async startSprint(sprintId: number, startDate: string, endDate: string): Promise<Sprint> {
    // Jira API requires sprint name when updating state - fetch it first
    const currentSprint = await this.getSprint(sprintId);
    return this.updateSprint(sprintId, {
      name: currentSprint.name,
      state: SprintState.ACTIVE,
      startDate,
      endDate,
    });
  }

  async completeSprint(sprintId: number): Promise<Sprint> {
    // Jira API requires sprint name, startDate, endDate when updating state
    const currentSprint = await this.getSprint(sprintId);
    return this.updateSprint(sprintId, {
      name: currentSprint.name,
      state: SprintState.CLOSED,
      startDate: currentSprint.startDate,
      endDate: currentSprint.endDate,
    });
  }

  async listSprintsForBoard(boardId: number, state?: SprintState): Promise<Sprint[]> {
    try {
      const params: Record<string, string> = {};
      if (state) params.state = state;

      const response = await this.agileClient.get(`/board/${boardId}/sprint`, { params });
      return response.data.values.map((s: unknown) => this.parseSprint(s));
    } catch (error) {
      this.handleError(error);
    }
  }

  async moveIssuesToSprint(sprintId: number, issueKeys: string[]): Promise<void> {
    try {
      await this.agileClient.post(`/sprint/${sprintId}/issue`, {
        issues: issueKeys,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getSprintIssues(sprintId: number): Promise<Issue[]> {
    try {
      const response = await this.agileClient.get(`/sprint/${sprintId}/issue`, {
        params: {
          fields: [
            "summary", "description", "issuetype", "status", "priority",
            "project", "assignee", "reporter", "labels", "sprint",
            "created", "updated", "customfield_10016"
          ].join(","),
        },
      });
      return response.data.issues.map((i: unknown) => this.parseIssue(i));
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Board Operations ====================

  async getBoard(boardId: number): Promise<Board> {
    try {
      const response = await this.agileClient.get(`/board/${boardId}`);
      return this.parseBoard(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async listBoards(projectKey?: string): Promise<Board[]> {
    try {
      const params: Record<string, string> = {};
      if (projectKey) params.projectKeyOrId = projectKey;

      const response = await this.agileClient.get("/board", { params });
      return response.data.values.map((b: unknown) => this.parseBoard(b));
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== User Operations ====================

  async getCurrentUser(): Promise<User> {
    try {
      const response = await this.client.get("/myself");
      return this.parseUser(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async searchUsers(query: string): Promise<User[]> {
    try {
      const response = await this.client.get("/user/search", {
        params: { query },
      });
      return response.data.map((u: unknown) => this.parseUser(u));
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Field Configuration Operations ====================

  async getCreateMeta(projectKey: string, issueType?: string): Promise<CreateMeta> {
    try {
      const params: Record<string, string> = {
        projectKeys: projectKey,
        expand: "projects.issuetypes.fields",
      };
      if (issueType) {
        params.issuetypeNames = issueType;
      }

      const response = await this.client.get("/issue/createmeta", { params });
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getFieldConfigurations(): Promise<FieldConfiguration[]> {
    try {
      const response = await this.client.get("/fieldconfiguration");
      return response.data.values || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  async getFieldConfiguration(id: string): Promise<FieldConfiguration> {
    try {
      const response = await this.client.get(`/fieldconfiguration`, {
        params: { id: [id] },
      });
      if (response.data.values && response.data.values.length > 0) {
        return response.data.values[0];
      }
      throw new JiraClientError(`Field configuration ${id} not found`, 404);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getFieldConfigurationItems(id: string): Promise<FieldConfigurationItem[]> {
    try {
      const response = await this.client.get(`/fieldconfiguration/${id}/fields`);
      return response.data.values || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  async updateFieldConfigurationItem(
    fieldConfigId: string,
    fieldId: string,
    updates: Partial<FieldConfigurationItem>
  ): Promise<void> {
    try {
      await this.client.put(`/fieldconfiguration/${fieldConfigId}/fields`, {
        fieldConfigurationItems: [
          {
            id: fieldId,
            ...updates,
          },
        ],
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Custom Field Operations ====================

  /**
   * List all fields (system and custom)
   */
  async listFields(): Promise<CustomField[]> {
    try {
      const response = await this.client.get("/field");
      return response.data.map((f: unknown) => this.parseField(f));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * List only custom fields
   */
  async listCustomFields(): Promise<CustomField[]> {
    const fields = await this.listFields();
    return fields.filter(f => f.custom);
  }

  /**
   * Get a specific field by ID
   */
  async getField(fieldId: string): Promise<CustomField | undefined> {
    const fields = await this.listFields();
    return fields.find(f => f.id === fieldId || f.key === fieldId);
  }

  /**
   * Get options for a custom field (select/multi-select fields)
   */
  async getFieldOptions(fieldId: string, contextId?: string): Promise<CustomFieldOption[]> {
    try {
      // Extract numeric ID from customfield_XXXXX format
      const numericId = fieldId.replace("customfield_", "");
      const url = contextId
        ? `/field/customfield_${numericId}/context/${contextId}/option`
        : `/field/customfield_${numericId}/option`;

      const response = await this.client.get(url);
      return response.data.values || [];
    } catch (error) {
      // If no options available, return empty array
      if (error instanceof AxiosError && error.response?.status === 404) {
        return [];
      }
      this.handleError(error);
    }
  }

  /**
   * Get custom field value for an issue (returns raw field value)
   */
  async getIssueFieldValue(issueKey: string, fieldId: string): Promise<unknown> {
    try {
      const response = await this.client.get(`/issue/${issueKey}`, {
        params: { fields: fieldId },
      });
      return response.data.fields?.[fieldId];
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Set custom field value on an issue
   */
  async setIssueFieldValue(issueKey: string, fieldId: string, value: unknown): Promise<Issue> {
    try {
      await this.client.put(`/issue/${issueKey}`, {
        fields: { [fieldId]: value },
      });
      return this.getIssue(issueKey);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get multiple custom field values for an issue
   */
  async getIssueCustomFields(issueKey: string, fieldIds?: string[]): Promise<Record<string, unknown>> {
    try {
      const params: Record<string, string> = {};
      if (fieldIds?.length) {
        params.fields = fieldIds.join(",");
      }

      const response = await this.client.get(`/issue/${issueKey}`, { params });
      const fields = response.data.fields || {};

      // Filter to only custom fields if no specific fieldIds requested
      if (!fieldIds) {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(fields)) {
          if (key.startsWith("customfield_")) {
            result[key] = value;
          }
        }
        return result;
      }

      return fields;
    } catch (error) {
      this.handleError(error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseField(data: any): CustomField {
    return {
      id: data.id,
      key: data.key || data.id,
      name: data.name,
      description: data.description,
      type: data.schema?.type || "unknown",
      custom: data.custom ?? data.id?.startsWith("customfield_") ?? false,
      schema: data.schema,
      searchable: data.searchable ?? false,
      navigable: data.navigable ?? false,
    };
  }

  // ==================== Time Tracking Operations ====================

  /**
   * Get worklogs for an issue
   */
  async getWorklogs(issueKey: string): Promise<Worklog[]> {
    try {
      const response = await this.client.get(`/issue/${issueKey}/worklog`);
      return (response.data.worklogs || []).map((w: unknown) => this.parseWorklog(w));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Add a worklog to an issue
   */
  async addWorklog(issueKey: string, data: WorklogCreate): Promise<Worklog> {
    try {
      const payload: Record<string, unknown> = {};

      if (data.timeSpent) {
        payload.timeSpent = data.timeSpent;
      } else if (data.timeSpentSeconds) {
        payload.timeSpentSeconds = data.timeSpentSeconds;
      }

      if (data.started) {
        payload.started = data.started;
      }

      if (data.comment) {
        payload.comment = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: data.comment }],
            },
          ],
        };
      }

      const response = await this.client.post(`/issue/${issueKey}/worklog`, payload);
      return this.parseWorklog(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update a worklog
   */
  async updateWorklog(issueKey: string, worklogId: string, data: WorklogCreate): Promise<Worklog> {
    try {
      const payload: Record<string, unknown> = {};

      if (data.timeSpent) {
        payload.timeSpent = data.timeSpent;
      } else if (data.timeSpentSeconds) {
        payload.timeSpentSeconds = data.timeSpentSeconds;
      }

      if (data.started) {
        payload.started = data.started;
      }

      if (data.comment) {
        payload.comment = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: data.comment }],
            },
          ],
        };
      }

      const response = await this.client.put(`/issue/${issueKey}/worklog/${worklogId}`, payload);
      return this.parseWorklog(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete a worklog
   */
  async deleteWorklog(issueKey: string, worklogId: string): Promise<void> {
    try {
      await this.client.delete(`/issue/${issueKey}/worklog/${worklogId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get time tracking info for an issue
   */
  async getTimeTracking(issueKey: string): Promise<TimeTracking> {
    try {
      const response = await this.client.get(`/issue/${issueKey}`, {
        params: { fields: "timetracking" },
      });
      return response.data.fields?.timetracking || {};
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Set time tracking estimates on an issue
   */
  async setTimeTracking(
    issueKey: string,
    originalEstimate?: string,
    remainingEstimate?: string
  ): Promise<TimeTracking> {
    try {
      const timetracking: Record<string, string> = {};
      if (originalEstimate) {
        timetracking.originalEstimate = originalEstimate;
      }
      if (remainingEstimate) {
        timetracking.remainingEstimate = remainingEstimate;
      }

      await this.client.put(`/issue/${issueKey}`, {
        fields: { timetracking },
      });

      return this.getTimeTracking(issueKey);
    } catch (error) {
      this.handleError(error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseWorklog(data: any): Worklog {
    return {
      id: data.id,
      issueId: data.issueId,
      author: this.parseUser(data.author),
      updateAuthor: data.updateAuthor ? this.parseUser(data.updateAuthor) : undefined,
      comment: this.parseDescription(data.comment),
      started: data.started,
      timeSpent: data.timeSpent,
      timeSpentSeconds: data.timeSpentSeconds,
      created: data.created,
      updated: data.updated,
    };
  }

  // ==================== Attachment Operations ====================

  /**
   * Get all attachments for an issue
   */
  async getAttachments(issueKey: string): Promise<Attachment[]> {
    try {
      const response = await this.client.get(`/issue/${issueKey}`, {
        params: { fields: "attachment" },
      });
      const attachments = response.data.fields?.attachment || [];
      return attachments.map((a: unknown) => this.parseAttachment(a));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Add an attachment to an issue
   * Note: This requires a file path or buffer - implementation depends on runtime
   */
  async addAttachment(
    issueKey: string,
    filename: string,
    content: Buffer | string
  ): Promise<Attachment[]> {
    try {
      const FormData = (await import("form-data")).default;
      const form = new FormData();

      // If content is a string, treat it as base64 encoded
      const buffer = typeof content === "string" ? Buffer.from(content, "base64") : content;
      form.append("file", buffer, { filename });

      const response = await this.client.post(`/issue/${issueKey}/attachments`, form, {
        headers: {
          ...form.getHeaders(),
          "X-Atlassian-Token": "no-check",
        },
      });

      return response.data.map((a: unknown) => this.parseAttachment(a));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete an attachment
   */
  async deleteAttachment(attachmentId: string): Promise<void> {
    try {
      await this.client.delete(`/attachment/${attachmentId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get attachment metadata
   */
  async getAttachment(attachmentId: string): Promise<Attachment> {
    try {
      const response = await this.client.get(`/attachment/${attachmentId}`);
      return this.parseAttachment(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseAttachment(data: any): Attachment {
    return {
      id: data.id,
      filename: data.filename,
      author: this.parseUser(data.author),
      created: data.created,
      size: data.size,
      mimeType: data.mimeType,
      content: data.content,
      thumbnail: data.thumbnail,
    };
  }

  // ==================== Webhook Operations ====================

  /**
   * List all webhooks registered for this Jira instance
   */
  async listWebhooks(): Promise<Webhook[]> {
    try {
      const response = await this.client.get("/webhook");
      return (response.data.values || []).map((w: unknown) => this.parseWebhook(w));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific webhook by ID
   */
  async getWebhook(webhookId: number): Promise<Webhook> {
    try {
      const webhooks = await this.listWebhooks();
      const webhook = webhooks.find(w => w.id === webhookId);
      if (!webhook) {
        throw new JiraClientError(`Webhook ${webhookId} not found`, 404);
      }
      return webhook;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Register a new webhook
   * Note: Jira Cloud requires Connect apps or OAuth 2.0 for webhook registration
   */
  async createWebhook(data: WebhookCreate): Promise<Webhook> {
    try {
      const payload = {
        webhooks: [{
          jqlFilter: data.filters?.issueRelatedEventsSection || "TRUE",
          events: data.events,
          fieldIdsFilter: [],
          issuePropertyKeysFilter: [],
        }],
        url: data.url,
      };

      const response = await this.client.post("/webhook", payload);

      // The response contains webhook IDs that were created
      if (response.data.webhookRegistrationResult?.[0]?.createdWebhookId) {
        return this.getWebhook(response.data.webhookRegistrationResult[0].createdWebhookId);
      }

      // Return a constructed webhook if immediate fetch not possible
      return {
        id: response.data.webhookRegistrationResult?.[0]?.createdWebhookId || 0,
        name: data.name,
        url: data.url,
        events: data.events,
        filters: data.filters,
        enabled: true,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete webhooks by IDs
   */
  async deleteWebhooks(webhookIds: number[]): Promise<void> {
    try {
      await this.client.delete("/webhook", {
        data: { webhookIds },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Refresh webhooks to extend their expiration
   */
  async refreshWebhooks(webhookIds: number[]): Promise<{ refreshedWebhooks: number[]; failedWebhooks: number[] }> {
    try {
      const response = await this.client.put("/webhook/refresh", { webhookIds });
      return {
        refreshedWebhooks: response.data.webhooksRefreshed || [],
        failedWebhooks: response.data.webhooksNotRefreshed || [],
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get failed webhook calls that need to be retried
   */
  async getFailedWebhooks(after?: number): Promise<{ webhookId: number; failureTime: number }[]> {
    try {
      const params: Record<string, unknown> = {};
      if (after) params.after = after;

      const response = await this.client.get("/webhook/failed", { params });
      return response.data.values || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseWebhook(data: any): Webhook {
    return {
      id: data.id,
      name: data.name || `Webhook ${data.id}`,
      url: data.url || data.self,
      events: data.events || [],
      filters: data.filters,
      enabled: data.enabled ?? true,
      self: data.self,
      lastUpdatedUser: data.lastUpdatedUser ? this.parseUser(data.lastUpdatedUser) : undefined,
      lastUpdatedDisplayName: data.lastUpdatedDisplayName,
      lastUpdated: data.lastUpdated,
    };
  }

  // ==================== Issue Link Operations ====================

  /**
   * List all available issue link types
   */
  async listIssueLinkTypes(): Promise<IssueLinkType[]> {
    try {
      const response = await this.client.get("/issueLinkType");
      return (response.data.issueLinkTypes || []).map((lt: unknown) => this.parseIssueLinkType(lt));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific issue link type by ID
   */
  async getIssueLinkType(linkTypeId: string): Promise<IssueLinkType> {
    try {
      const response = await this.client.get(`/issueLinkType/${linkTypeId}`);
      return this.parseIssueLinkType(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get all links for an issue
   */
  async getIssueLinks(issueKey: string): Promise<IssueLink[]> {
    try {
      const response = await this.client.get(`/issue/${issueKey}`, {
        params: { fields: "issuelinks" },
      });
      const links = response.data.fields?.issuelinks || [];
      return links.map((link: unknown) => this.parseIssueLink(link));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create a link between two issues
   */
  async createIssueLink(data: IssueLinkCreate): Promise<{ success: boolean; message: string }> {
    try {
      const payload: Record<string, unknown> = {
        type: { name: data.type },
      };

      if (data.inwardIssue) {
        payload.inwardIssue = { key: data.inwardIssue };
      }
      if (data.outwardIssue) {
        payload.outwardIssue = { key: data.outwardIssue };
      }
      if (data.comment) {
        payload.comment = {
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: data.comment }],
              },
            ],
          },
        };
      }

      await this.client.post("/issueLink", payload);
      return { success: true, message: `Link created: ${data.inwardIssue || "?"} ${data.type} ${data.outwardIssue || "?"}` };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete an issue link by ID
   */
  async deleteIssueLink(linkId: string): Promise<void> {
    try {
      await this.client.delete(`/issueLink/${linkId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific issue link by ID
   */
  async getIssueLink(linkId: string): Promise<IssueLink> {
    try {
      const response = await this.client.get(`/issueLink/${linkId}`);
      return this.parseIssueLink(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseIssueLinkType(data: any): IssueLinkType {
    return {
      id: data.id,
      name: data.name,
      inward: data.inward,
      outward: data.outward,
      self: data.self,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseIssueLink(data: any): IssueLink {
    return {
      id: data.id,
      type: this.parseIssueLinkType(data.type),
      inwardIssue: data.inwardIssue ? this.parseLinkedIssue(data.inwardIssue) : undefined,
      outwardIssue: data.outwardIssue ? this.parseLinkedIssue(data.outwardIssue) : undefined,
      self: data.self,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseLinkedIssue(data: any): { id: string; key: string; self?: string; fields?: { summary?: string; status?: { name: string }; issuetype?: { name: string }; priority?: { name: string } } } {
    return {
      id: data.id,
      key: data.key,
      self: data.self,
      fields: data.fields ? {
        summary: data.fields.summary,
        status: data.fields.status ? { name: data.fields.status.name } : undefined,
        issuetype: data.fields.issuetype ? { name: data.fields.issuetype.name } : undefined,
        priority: data.fields.priority ? { name: data.fields.priority.name } : undefined,
      } : undefined,
    };
  }

  // ==================== Sprint Analytics Operations ====================

  /**
   * Get a comprehensive sprint report
   */
  async getSprintReport(sprintId: number): Promise<SprintReport> {
    try {
      // Get sprint details
      const sprint = await this.getSprint(sprintId);

      // Get all issues in sprint
      const issues = await this.getSprintIssues(sprintId);

      // Categorize issues
      const completedIssues = issues.filter(i => i.status === "Done" || i.status === "Closed");
      const incompleteIssues = issues.filter(i => i.status !== "Done" && i.status !== "Closed");

      // Calculate points
      const completedPoints = completedIssues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
      const totalPoints = issues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);

      // Calculate completion rates
      const completionRate = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
      const issueCompletionRate = issues.length > 0
        ? Math.round((completedIssues.length / issues.length) * 100)
        : 0;

      return {
        sprint,
        completedIssues,
        incompleteIssues,
        puntedIssues: [], // Would need sprint change history API
        addedIssues: [], // Would need sprint change history API
        completedPoints,
        totalPoints,
        completionRate,
        issueCompletionRate,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get velocity for a single sprint
   */
  async getSprintVelocity(sprintId: number): Promise<SprintVelocity> {
    try {
      const sprint = await this.getSprint(sprintId);
      const issues = await this.getSprintIssues(sprintId);

      const completedIssues = issues.filter(i => i.status === "Done" || i.status === "Closed");
      const completedPoints = completedIssues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
      const committedPoints = issues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);

      return {
        sprintId: sprint.id,
        sprintName: sprint.name,
        completedPoints,
        committedPoints,
        completedIssues: completedIssues.length,
        totalIssues: issues.length,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get velocity report for a board (multiple sprints)
   */
  async getVelocityReport(boardId: number, sprintCount = 5): Promise<VelocityReport> {
    try {
      // Get closed sprints (completed sprints have velocity data)
      const closedSprints = await this.listSprintsForBoard(boardId, SprintState.CLOSED);

      // Take the most recent sprints
      const recentSprints = closedSprints
        .sort((a, b) => (b.completeDate || "").localeCompare(a.completeDate || ""))
        .slice(0, sprintCount);

      // Get velocity for each sprint
      const velocities: SprintVelocity[] = [];
      for (const sprint of recentSprints) {
        const velocity = await this.getSprintVelocity(sprint.id);
        velocities.push(velocity);
      }

      // Reverse to show chronological order (oldest first)
      velocities.reverse();

      // Calculate average velocity
      const totalCompleted = velocities.reduce((sum, v) => sum + v.completedPoints, 0);
      const averageVelocity = velocities.length > 0
        ? Math.round(totalCompleted / velocities.length)
        : 0;

      // Determine trend
      let velocityTrend: "increasing" | "decreasing" | "stable" = "stable";
      if (velocities.length >= 3) {
        const recentAvg = (velocities[velocities.length - 1].completedPoints +
          velocities[velocities.length - 2].completedPoints) / 2;
        const earlierAvg = (velocities[0].completedPoints + velocities[1].completedPoints) / 2;

        if (recentAvg > earlierAvg * 1.1) {
          velocityTrend = "increasing";
        } else if (recentAvg < earlierAvg * 0.9) {
          velocityTrend = "decreasing";
        }
      }

      return {
        boardId,
        sprints: velocities,
        averageVelocity,
        velocityTrend,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get burndown data for a sprint
   */
  async getSprintBurndown(sprintId: number): Promise<SprintBurndown> {
    try {
      const sprint = await this.getSprint(sprintId);
      const issues = await this.getSprintIssues(sprintId);

      if (!sprint.startDate || !sprint.endDate) {
        throw new JiraClientError("Sprint must have start and end dates for burndown", 400);
      }

      const totalPoints = issues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
      const startDate = new Date(sprint.startDate);
      const endDate = new Date(sprint.endDate);

      // Calculate number of days in sprint
      const sprintDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const pointsPerDay = totalPoints / sprintDays;

      // Generate data points
      const dataPoints: BurndownPoint[] = [];
      const completedIssues = issues.filter(i => i.status === "Done" || i.status === "Closed");
      const completedPoints = completedIssues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
      const remainingPoints = totalPoints - completedPoints;

      const today = new Date();
      for (let day = 0; day <= sprintDays; day++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + day);

        const idealPoints = Math.max(0, totalPoints - (pointsPerDay * day));

        // For past/current dates, show actual remaining
        // For future dates, show ideal line
        const dateStr = currentDate.toISOString().split("T")[0];
        const isPastOrToday = currentDate <= today;

        dataPoints.push({
          date: dateStr,
          remainingPoints: isPastOrToday ? remainingPoints : idealPoints,
          idealPoints: Math.round(idealPoints * 10) / 10,
          completedPoints: isPastOrToday ? completedPoints : 0,
        });
      }

      return {
        sprintId: sprint.id,
        sprintName: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        totalPoints,
        dataPoints,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== JQL Filter Operations ====================

  /**
   * List all filters owned by or shared with the user
   */
  async listFilters(expand?: string): Promise<JqlFilter[]> {
    try {
      const params: Record<string, string> = {};
      if (expand) params.expand = expand;

      const response = await this.client.get("/filter/my", { params });
      return (response.data || []).map((f: unknown) => this.parseFilter(f));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific filter by ID
   */
  async getFilter(filterId: string, expand?: string): Promise<JqlFilter> {
    try {
      const params: Record<string, string> = {};
      if (expand) params.expand = expand;

      const response = await this.client.get(`/filter/${filterId}`, { params });
      return this.parseFilter(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Search for filters by name
   */
  async searchFilters(filterName: string, expand?: string): Promise<JqlFilter[]> {
    try {
      const params: Record<string, string> = {
        filterName,
      };
      if (expand) params.expand = expand;

      const response = await this.client.get("/filter/search", { params });
      return (response.data.values || []).map((f: unknown) => this.parseFilter(f));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create a new filter
   */
  async createFilter(data: FilterCreate): Promise<JqlFilter> {
    try {
      const payload: Record<string, unknown> = {
        name: data.name,
        jql: data.jql,
      };

      if (data.description) payload.description = data.description;
      if (data.favourite !== undefined) payload.favourite = data.favourite;
      if (data.sharePermissions) payload.sharePermissions = data.sharePermissions;
      if (data.editPermissions) payload.editPermissions = data.editPermissions;

      const response = await this.client.post("/filter", payload);
      return this.parseFilter(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update an existing filter
   */
  async updateFilter(filterId: string, data: FilterUpdate): Promise<JqlFilter> {
    try {
      const payload: Record<string, unknown> = {};

      if (data.name) payload.name = data.name;
      if (data.description !== undefined) payload.description = data.description;
      if (data.jql) payload.jql = data.jql;
      if (data.favourite !== undefined) payload.favourite = data.favourite;
      if (data.sharePermissions) payload.sharePermissions = data.sharePermissions;
      if (data.editPermissions) payload.editPermissions = data.editPermissions;

      const response = await this.client.put(`/filter/${filterId}`, payload);
      return this.parseFilter(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete a filter
   */
  async deleteFilter(filterId: string): Promise<void> {
    try {
      await this.client.delete(`/filter/${filterId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Set or unset a filter as favourite
   */
  async setFilterFavourite(filterId: string, favourite: boolean): Promise<JqlFilter> {
    try {
      if (favourite) {
        const response = await this.client.put(`/filter/${filterId}/favourite`);
        return this.parseFilter(response.data);
      } else {
        const response = await this.client.delete(`/filter/${filterId}/favourite`);
        return this.parseFilter(response.data);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get favourite filters
   */
  async getFavouriteFilters(expand?: string): Promise<JqlFilter[]> {
    try {
      const params: Record<string, string> = {};
      if (expand) params.expand = expand;

      const response = await this.client.get("/filter/favourite", { params });
      return (response.data || []).map((f: unknown) => this.parseFilter(f));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Execute a saved filter (search issues using filter's JQL)
   */
  async executeFilter(filterId: string, maxResults = 50): Promise<SearchResult> {
    const filter = await this.getFilter(filterId);
    return this.searchIssues(filter.jql, maxResults);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseFilter(data: any): JqlFilter {
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      owner: data.owner ? this.parseUser(data.owner) : undefined,
      jql: data.jql,
      viewUrl: data.viewUrl,
      searchUrl: data.searchUrl,
      favourite: data.favourite ?? false,
      favouritedCount: data.favouritedCount ?? 0,
      sharePermissions: data.sharePermissions || [],
      editPermissions: data.editPermissions || [],
      self: data.self,
    };
  }

  // ==================== Bulk Operations with Verification ====================

  /**
   * Create multiple issues with verification
   */
  async bulkCreateIssues(
    issues: IssueCreate[]
  ): Promise<BulkOperationResult> {
    return this.verifier.runBulkOperation(
      "bulkCreateIssues",
      issues,
      async (data) => this.createIssue(data),
      async (data, result) => this.verifier.verifyIssueCreated(
        result.key,
        () => this.getIssue(result.key),
        data.summary
      )
    );
  }

  /**
   * Move multiple issues to sprint with verification
   */
  async bulkMoveToSprintWithVerification(
    sprintId: number,
    issueKeys: string[]
  ): Promise<BulkOperationResult> {
    const startTime = Date.now();

    // Execute the move
    await this.moveIssuesToSprint(sprintId, issueKeys);

    // Verify all issues are in sprint
    const verification = await this.verifier.verifyIssuesInSprint(
      sprintId,
      issueKeys,
      () => this.getSprintIssues(sprintId)
    );

    return {
      operation: "bulkMoveToSprint",
      total: issueKeys.length,
      succeeded: verification.success ? issueKeys.length : 0,
      failed: verification.success ? 0 : issueKeys.length,
      results: [verification],
      duration: Date.now() - startTime,
      summary: verification.success
        ? `Moved ${issueKeys.length} issues to sprint ${sprintId}`
        : `Failed to verify issues in sprint ${sprintId}: ${verification.error}`,
    };
  }

  /**
   * Transition multiple issues with verification
   */
  async bulkTransitionIssues(
    issueKeys: string[],
    transitionName: string
  ): Promise<BulkOperationResult> {
    return this.verifier.runBulkOperation(
      "bulkTransitionIssues",
      issueKeys,
      async (issueKey) => {
        const transitions = await this.getTransitions(issueKey);
        const targetTransition = transitions.find(
          (t) => t.name.toLowerCase() === transitionName.toLowerCase()
        );
        if (!targetTransition) {
          throw new Error(`Transition '${transitionName}' not available for ${issueKey}`);
        }
        await this.transitionIssue(issueKey, targetTransition.id);
        // Return target status name for verification (transition name != status name)
        return { issueKey, transitionName, targetStatus: targetTransition.to.name };
      },
      async (issueKey, result) => this.verifier.verify(
        "transitionIssue",
        issueKey,
        () => this.getIssue(issueKey),
        // Compare against targetStatus (e.g., "Done") not transitionName (e.g., "Work Finished")
        (issue) => {
          const targetStatus = (result as { targetStatus: string }).targetStatus.toLowerCase();
          return issue.status.toLowerCase() === targetStatus;
        }
      )
    );
  }

  /**
   * Update multiple issues with the same changes
   */
  async bulkUpdateIssues(
    issueKeys: string[],
    updates: IssueUpdate
  ): Promise<BulkOperationResult> {
    return this.verifier.runBulkOperation(
      "bulkUpdateIssues",
      issueKeys,
      async (issueKey) => this.updateIssue(issueKey, updates),
      async (issueKey, result) => this.verifier.verify(
        "updateIssue",
        issueKey,
        () => this.getIssue(issueKey),
        (issue) => {
          // Verify at least one update took effect
          if (updates.summary && issue.summary !== updates.summary) return false;
          if (updates.priority && issue.priority !== updates.priority) return false;
          if (updates.assigneeId !== undefined) {
            if (updates.assigneeId && issue.assignee?.accountId !== updates.assigneeId) return false;
            if (!updates.assigneeId && issue.assignee) return false;
          }
          return true;
        }
      )
    );
  }

  /**
   * Delete multiple issues
   */
  async bulkDeleteIssues(issueKeys: string[]): Promise<BulkOperationResult> {
    return this.verifier.runBulkOperation(
      "bulkDeleteIssues",
      issueKeys,
      async (issueKey) => {
        await this.deleteIssue(issueKey);
        return { issueKey, deleted: true };
      },
      async (issueKey): Promise<VerificationResult> => {
        // Verify deletion by attempting to fetch (should fail)
        try {
          await this.getIssue(issueKey);
          return {
            success: false,
            operation: "deleteIssue",
            target: issueKey,
            error: "Issue still exists",
            timestamp: new Date().toISOString(),
          };
        } catch {
          return {
            success: true,
            operation: "deleteIssue",
            target: issueKey,
            timestamp: new Date().toISOString(),
          };
        }
      }
    );
  }

  /**
   * Add labels to multiple issues
   */
  async bulkAddLabels(issueKeys: string[], labels: string[]): Promise<BulkOperationResult> {
    return this.verifier.runBulkOperation(
      "bulkAddLabels",
      issueKeys,
      async (issueKey) => {
        const issue = await this.getIssue(issueKey);
        const existingLabels = issue.labels || [];
        const newLabels = [...new Set([...existingLabels, ...labels])];
        return this.updateIssue(issueKey, { labels: newLabels });
      },
      async (issueKey) => this.verifier.verify(
        "addLabels",
        issueKey,
        () => this.getIssue(issueKey),
        (issue) => labels.every(label => issue.labels.includes(label))
      )
    );
  }

  /**
   * Assign multiple issues to the same user
   */
  async bulkAssignIssues(issueKeys: string[], assigneeId: string | null): Promise<BulkOperationResult> {
    return this.verifier.runBulkOperation(
      "bulkAssignIssues",
      issueKeys,
      async (issueKey) => this.updateIssue(issueKey, { assigneeId: assigneeId || "" }),
      async (issueKey) => this.verifier.verify(
        "assignIssue",
        issueKey,
        () => this.getIssue(issueKey),
        (issue) => {
          if (assigneeId === null || assigneeId === "") {
            return !issue.assignee;
          }
          return issue.assignee?.accountId === assigneeId;
        }
      )
    );
  }

  // ==================== Parsing Helpers ====================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseIssue(data: any): Issue {
    const fields = data.fields || {};
    const sprint = fields.sprint;

    return {
      id: data.id,
      key: data.key,
      summary: fields.summary || "",
      description: this.parseDescription(fields.description),
      issueType: fields.issuetype?.name || "Unknown",
      status: fields.status?.name || "Unknown",
      priority: fields.priority?.name,
      projectKey: fields.project?.key || "",
      assignee: fields.assignee ? this.parseUser(fields.assignee) : undefined,
      reporter: fields.reporter ? this.parseUser(fields.reporter) : undefined,
      labels: fields.labels || [],
      sprintId: sprint?.id,
      created: fields.created,
      updated: fields.updated,
      storyPoints: fields.customfield_10016,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseDescription(desc: any): string | undefined {
    if (!desc) return undefined;
    if (typeof desc === "string") return desc;

    // Parse ADF (Atlassian Document Format)
    if (desc.type === "doc" && desc.content) {
      return this.extractTextFromAdf(desc.content);
    }
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractTextFromAdf(content: any[]): string {
    return content
      .map((node) => {
        if (node.type === "text") return node.text;
        if (node.content) return this.extractTextFromAdf(node.content);
        return "";
      })
      .join("");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseUser(data: any): User {
    return {
      accountId: data.accountId,
      displayName: data.displayName || "Unknown",
      emailAddress: data.emailAddress,
      active: data.active ?? true,
      avatarUrl: data.avatarUrls?.["48x48"],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseProject(data: any): Project {
    return {
      id: data.id,
      key: data.key,
      name: data.name,
      description: data.description,
      lead: data.lead ? this.parseUser(data.lead) : undefined,
      projectType: data.projectTypeKey || "software",
      style: data.style,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseSprint(data: any): Sprint {
    return {
      id: data.id,
      name: data.name,
      state: data.state as SprintState,
      startDate: data.startDate,
      endDate: data.endDate,
      completeDate: data.completeDate,
      boardId: data.originBoardId,
      goal: data.goal,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseBoard(data: any): Board {
    return {
      id: data.id,
      name: data.name,
      boardType: data.type || "scrum",
      projectKey: data.location?.projectKey,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseComment(data: any): Comment {
    return {
      id: data.id,
      body: this.parseDescription(data.body) || "",
      author: this.parseUser(data.author),
      created: data.created,
      updated: data.updated,
    };
  }

  private buildIssuePayload(data: IssueCreate): { fields: Record<string, unknown> } {
    const fields: Record<string, unknown> = {
      project: { key: data.projectKey },
      summary: data.summary,
      issuetype: { name: data.issueType || "Task" },
    };

    if (data.description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: data.description }],
          },
        ],
      };
    }

    if (data.priority) fields.priority = { name: data.priority };
    if (data.assigneeId) fields.assignee = { accountId: data.assigneeId };
    if (data.labels?.length) fields.labels = data.labels;
    if (data.parentKey) fields.parent = { key: data.parentKey };
    if (data.storyPoints) fields.customfield_10016 = data.storyPoints;

    return { fields };
  }

  private buildUpdatePayload(data: IssueUpdate): { fields: Record<string, unknown> } {
    const fields: Record<string, unknown> = {};

    if (data.summary) fields.summary = data.summary;
    if (data.description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: data.description }],
          },
        ],
      };
    }
    if (data.priority) fields.priority = { name: data.priority };
    if (data.assigneeId !== undefined) {
      fields.assignee = data.assigneeId ? { accountId: data.assigneeId } : null;
    }
    if (data.labels) fields.labels = data.labels;
    if (data.storyPoints !== undefined) fields.customfield_10016 = data.storyPoints;
    if (data.parentKey !== undefined) {
      fields.parent = data.parentKey ? { key: data.parentKey } : null;
    }

    return { fields };
  }
}
