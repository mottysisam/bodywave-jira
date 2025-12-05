/**
 * Jira REST API Client
 *
 * Reads configuration from environment variables:
 * - JIRA_URL: Jira instance URL (e.g., https://bodywave.atlassian.net)
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
} from "./types.js";

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

  constructor(config?: JiraConfig) {
    this.config = config ?? getConfigFromEnv();

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
    return this.updateSprint(sprintId, {
      state: SprintState.ACTIVE,
      startDate,
      endDate,
    });
  }

  async completeSprint(sprintId: number): Promise<Sprint> {
    return this.updateSprint(sprintId, { state: SprintState.CLOSED });
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

    return { fields };
  }
}
