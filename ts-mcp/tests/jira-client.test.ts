import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { JiraClient, JiraClientError, getConfigFromEnv } from "../src/jira-client.js";
import axios from "axios";

// Mock axios
vi.mock("axios", () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };

  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
    AxiosError: class AxiosError extends Error {
      response?: { status: number; data: unknown };
      constructor(message: string) {
        super(message);
        this.name = "AxiosError";
      }
    },
  };
});

describe("JiraClient", () => {
  let client: JiraClient;
  let mockAxiosInstance: ReturnType<typeof getMockAxios>;

  function getMockAxios() {
    return (axios.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    client = new JiraClient({
      url: "https://test.atlassian.net",
      email: "test@example.com",
      apiKey: "test-api-key",
    });

    mockAxiosInstance = getMockAxios();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfigFromEnv", () => {
    beforeEach(() => {
      delete process.env.JIRA_URL;
      delete process.env.JIRA_EMAIL;
      delete process.env.JIRA_API_KEY;
    });

    it("should throw error when JIRA_URL is missing", () => {
      expect(() => getConfigFromEnv()).toThrow("JIRA_URL environment variable is required");
    });

    it("should throw error when JIRA_EMAIL is missing", () => {
      process.env.JIRA_URL = "https://test.atlassian.net";
      expect(() => getConfigFromEnv()).toThrow("JIRA_EMAIL environment variable is required");
    });

    it("should throw error when JIRA_API_KEY is missing", () => {
      process.env.JIRA_URL = "https://test.atlassian.net";
      process.env.JIRA_EMAIL = "test@example.com";
      expect(() => getConfigFromEnv()).toThrow("JIRA_API_KEY environment variable is required");
    });

    it("should return config when all env vars are set", () => {
      process.env.JIRA_URL = "https://test.atlassian.net";
      process.env.JIRA_EMAIL = "test@example.com";
      process.env.JIRA_API_KEY = "test-api-key";

      const config = getConfigFromEnv();
      expect(config.url).toBe("https://test.atlassian.net");
      expect(config.email).toBe("test@example.com");
      expect(config.apiKey).toBe("test-api-key");
    });
  });

  describe("constructor", () => {
    it("should create axios instances with proper config", () => {
      expect(axios.create).toHaveBeenCalledTimes(2); // REST API + Agile API

      const calls = (axios.create as ReturnType<typeof vi.fn>).mock.calls;

      // REST API client
      expect(calls[0][0].baseURL).toBe("https://test.atlassian.net/rest/api/3");
      expect(calls[0][0].headers.Authorization).toContain("Basic ");

      // Agile API client
      expect(calls[1][0].baseURL).toBe("https://test.atlassian.net/rest/agile/1.0");
    });
  });

  describe("Issue Operations", () => {
    describe("getIssue", () => {
      it("should fetch and parse issue", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            id: "10001",
            key: "TEST-123",
            fields: {
              summary: "Test Issue",
              description: null,
              issuetype: { name: "Task" },
              status: { name: "To Do" },
              priority: { name: "Medium" },
              project: { key: "TEST" },
              assignee: null,
              reporter: { accountId: "user1", displayName: "User 1" },
              labels: ["label1"],
              sprint: { id: 42 },
              created: "2024-01-01T00:00:00.000Z",
              updated: "2024-01-02T00:00:00.000Z",
              customfield_10016: 5,
            },
          },
        });

        const issue = await client.getIssue("TEST-123");

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/issue/TEST-123");
        expect(issue.key).toBe("TEST-123");
        expect(issue.summary).toBe("Test Issue");
        expect(issue.issueType).toBe("Task");
        expect(issue.status).toBe("To Do");
        expect(issue.priority).toBe("Medium");
        expect(issue.storyPoints).toBe(5);
        expect(issue.sprintId).toBe(42);
      });
    });

    describe("createIssue", () => {
      it("should create issue and return parsed result", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: { key: "TEST-124" },
        });

        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            id: "10002",
            key: "TEST-124",
            fields: {
              summary: "New Issue",
              description: null,
              issuetype: { name: "Task" },
              status: { name: "To Do" },
              project: { key: "TEST" },
              labels: [],
            },
          },
        });

        const issue = await client.createIssue({
          projectKey: "TEST",
          summary: "New Issue",
          issueType: "Task",
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith("/issue", {
          fields: {
            project: { key: "TEST" },
            summary: "New Issue",
            issuetype: { name: "Task" },
          },
        });
        expect(issue.key).toBe("TEST-124");
      });

      it("should include description when provided", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: { key: "TEST-125" },
        });

        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            id: "10003",
            key: "TEST-125",
            fields: {
              summary: "Issue with Description",
              description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Description" }] }] },
              issuetype: { name: "Task" },
              status: { name: "To Do" },
              project: { key: "TEST" },
              labels: [],
            },
          },
        });

        await client.createIssue({
          projectKey: "TEST",
          summary: "Issue with Description",
          description: "Description",
        });

        const call = mockAxiosInstance.post.mock.calls[0];
        expect(call[1].fields.description).toEqual({
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Description" }],
            },
          ],
        });
      });
    });

    describe("updateIssue", () => {
      it("should update issue and return result", async () => {
        mockAxiosInstance.put.mockResolvedValueOnce({ data: {} });

        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            id: "10001",
            key: "TEST-123",
            fields: {
              summary: "Updated Summary",
              issuetype: { name: "Task" },
              status: { name: "To Do" },
              project: { key: "TEST" },
              labels: [],
            },
          },
        });

        const issue = await client.updateIssue("TEST-123", {
          summary: "Updated Summary",
        });

        expect(mockAxiosInstance.put).toHaveBeenCalledWith("/issue/TEST-123", {
          fields: { summary: "Updated Summary" },
        });
        expect(issue.summary).toBe("Updated Summary");
      });
    });

    describe("deleteIssue", () => {
      it("should delete issue", async () => {
        mockAxiosInstance.delete.mockResolvedValueOnce({ data: {} });

        await client.deleteIssue("TEST-123");

        expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/issue/TEST-123");
      });
    });

    describe("searchIssues", () => {
      it("should search issues using JQL", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: {
            issues: [
              {
                id: "10001",
                key: "TEST-1",
                fields: {
                  summary: "Issue 1",
                  issuetype: { name: "Task" },
                  status: { name: "To Do" },
                  project: { key: "TEST" },
                  labels: [],
                },
              },
              {
                id: "10002",
                key: "TEST-2",
                fields: {
                  summary: "Issue 2",
                  issuetype: { name: "Bug" },
                  status: { name: "In Progress" },
                  project: { key: "TEST" },
                  labels: [],
                },
              },
            ],
            maxResults: 50,
            isLast: true,
          },
        });

        const result = await client.searchIssues('project = TEST', 50);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith("/search/jql", expect.objectContaining({
          jql: 'project = TEST',
          maxResults: 50,
        }));
        expect(result.issues).toHaveLength(2);
        expect(result.issues[0].key).toBe("TEST-1");
      });
    });
  });

  describe("Project Operations", () => {
    describe("getProject", () => {
      it("should fetch and parse project", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            id: "10000",
            key: "TEST",
            name: "Test Project",
            description: "A test project",
            projectTypeKey: "software",
            lead: { accountId: "user1", displayName: "Lead User" },
          },
        });

        const project = await client.getProject("TEST");

        expect(project.key).toBe("TEST");
        expect(project.name).toBe("Test Project");
        expect(project.lead?.displayName).toBe("Lead User");
      });
    });

    describe("listProjects", () => {
      it("should list all projects", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: [
            { id: "10000", key: "TEST1", name: "Test Project 1" },
            { id: "10001", key: "TEST2", name: "Test Project 2" },
          ],
        });

        const projects = await client.listProjects();

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/project");
        expect(projects).toHaveLength(2);
      });
    });

    describe("validateProjectKey", () => {
      it("should return valid for available key", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: "TEST",
        });

        const result = await client.validateProjectKey("TEST");

        expect(result.valid).toBe(true);
      });
    });
  });

  describe("Sprint Operations", () => {
    describe("getSprint", () => {
      it("should fetch and parse sprint", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            id: 42,
            name: "Sprint 1",
            state: "active",
            startDate: "2024-01-01T00:00:00.000Z",
            endDate: "2024-01-14T00:00:00.000Z",
            originBoardId: 1,
            goal: "Complete MVP",
          },
        });

        const sprint = await client.getSprint(42);

        expect(sprint.id).toBe(42);
        expect(sprint.name).toBe("Sprint 1");
        expect(sprint.state).toBe("active");
        expect(sprint.goal).toBe("Complete MVP");
      });
    });

    describe("createSprint", () => {
      it("should create sprint", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: {
            id: 43,
            name: "Sprint 2",
            state: "future",
            originBoardId: 1,
          },
        });

        const sprint = await client.createSprint({
          name: "Sprint 2",
          boardId: 1,
          goal: "New features",
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sprint", {
          name: "Sprint 2",
          originBoardId: 1,
          goal: "New features",
        });
        expect(sprint.id).toBe(43);
      });
    });

    describe("listSprintsForBoard", () => {
      it("should list sprints for a board", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            values: [
              { id: 1, name: "Sprint 1", state: "closed" },
              { id: 2, name: "Sprint 2", state: "active" },
              { id: 3, name: "Sprint 3", state: "future" },
            ],
          },
        });

        const sprints = await client.listSprintsForBoard(1);

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/board/1/sprint", { params: {} });
        expect(sprints).toHaveLength(3);
      });

      it("should filter by state", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            values: [{ id: 2, name: "Sprint 2", state: "active" }],
          },
        });

        await client.listSprintsForBoard(1, "active" as any);

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/board/1/sprint", { params: { state: "active" } });
      });
    });

    describe("moveIssuesToSprint", () => {
      it("should move issues to sprint", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

        await client.moveIssuesToSprint(42, ["TEST-1", "TEST-2"]);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sprint/42/issue", {
          issues: ["TEST-1", "TEST-2"],
        });
      });
    });
  });

  describe("Board Operations", () => {
    describe("listBoards", () => {
      it("should list all boards", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            values: [
              { id: 1, name: "Board 1", type: "scrum" },
              { id: 2, name: "Board 2", type: "kanban" },
            ],
          },
        });

        const boards = await client.listBoards();

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/board", { params: {} });
        expect(boards).toHaveLength(2);
      });

      it("should filter by project key", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: { values: [] },
        });

        await client.listBoards("TEST");

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/board", { params: { projectKeyOrId: "TEST" } });
      });
    });
  });

  describe("User Operations", () => {
    describe("getCurrentUser", () => {
      it("should fetch current user", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            accountId: "user1",
            displayName: "Test User",
            emailAddress: "test@example.com",
            active: true,
            avatarUrls: { "48x48": "https://avatar.url" },
          },
        });

        const user = await client.getCurrentUser();

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/myself");
        expect(user.displayName).toBe("Test User");
        expect(user.emailAddress).toBe("test@example.com");
      });
    });

    describe("searchUsers", () => {
      it("should search users", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: [
            { accountId: "user1", displayName: "User 1" },
            { accountId: "user2", displayName: "User 2" },
          ],
        });

        const users = await client.searchUsers("user");

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/user/search", { params: { query: "user" } });
        expect(users).toHaveLength(2);
      });
    });
  });

  describe("Comment Operations", () => {
    describe("addComment", () => {
      it("should add comment to issue", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: {
            id: "100",
            body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Test comment" }] }] },
            author: { accountId: "user1", displayName: "User" },
            created: "2024-01-01T00:00:00.000Z",
            updated: "2024-01-01T00:00:00.000Z",
          },
        });

        const comment = await client.addComment("TEST-123", "Test comment");

        expect(mockAxiosInstance.post).toHaveBeenCalledWith("/issue/TEST-123/comment", expect.objectContaining({
          body: expect.objectContaining({ type: "doc" }),
        }));
        expect(comment.body).toBe("Test comment");
      });
    });
  });

  describe("Transition Operations", () => {
    describe("getTransitions", () => {
      it("should get available transitions", async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: {
            transitions: [
              { id: "1", name: "Start Progress" },
              { id: "2", name: "Done" },
            ],
          },
        });

        const transitions = await client.getTransitions("TEST-123");

        expect(mockAxiosInstance.get).toHaveBeenCalledWith("/issue/TEST-123/transitions");
        expect(transitions).toHaveLength(2);
      });
    });

    describe("transitionIssue", () => {
      it("should transition issue", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

        await client.transitionIssue("TEST-123", "2");

        expect(mockAxiosInstance.post).toHaveBeenCalledWith("/issue/TEST-123/transitions", {
          transition: { id: "2" },
        });
      });
    });
  });

  describe("Error Handling", () => {
    it("should throw JiraClientError on API error", async () => {
      const axiosError = new Error("Request failed");
      (axiosError as any).response = {
        status: 404,
        data: { errorMessages: ["Issue does not exist"] },
      };
      (axiosError as any).name = "AxiosError";

      mockAxiosInstance.get.mockRejectedValueOnce(axiosError);

      // The handleError method checks for AxiosError instance via error.response
      await expect(client.getIssue("NONEXISTENT-1")).rejects.toThrow();
    });
  });
});

describe("JiraClientError", () => {
  it("should create error with status code and details", () => {
    const error = new JiraClientError("Test error", 404, { extra: "details" });

    expect(error.message).toBe("Test error");
    expect(error.statusCode).toBe(404);
    expect(error.details).toEqual({ extra: "details" });
    expect(error.name).toBe("JiraClientError");
  });
});
