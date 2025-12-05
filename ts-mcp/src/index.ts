#!/usr/bin/env node
/**
 * Bodywave Jira MCP Server
 *
 * MCP server for Jira with full sprint management, bulk operations, and multi-account support.
 *
 * Install with:
 *   claude mcp add bodywave-jira --scope user -- env JIRA_URL=https://your-domain.atlassian.net JIRA_EMAIL=your@email.com JIRA_API_KEY=your-api-key npx -y @bodywave/jira-mcp
 *
 * Environment variables:
 *   - JIRA_URL: Jira instance URL (e.g., https://bodywave.atlassian.net)
 *   - JIRA_EMAIL: User email for authentication
 *   - JIRA_API_KEY: API token for authentication
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { JiraClient, JiraClientError } from "./jira-client.js";
import { SprintState, ProjectTemplate, ProjectTypeKey } from "./types.js";

import { logger } from "./logger.js";

// Version and changelog info
const VERSION_INFO = {
  version: "1.0.15",
  name: "@bodywave/jira-mcp",
  description: "MCP server for Jira with full sprint management, bulk operations, and multi-account support",
  changelog: [
    {
      version: "1.0.15",
      date: "2025-12-05",
      changes: [
        "Added jira_epic_workflow tool for DevOps automation",
        "Generates branch names, commit messages, and PR body from EPIC",
        "Opinionated conventions: feature/{EPIC-KEY}-{slug} branches, {TASK-KEY}: {summary} commits",
        "Includes post-merge task transition guidance",
      ],
    },
    {
      version: "1.0.14",
      date: "2025-12-05",
      changes: [
        "Fixed epic-story linking - parent_key now works in jira_update_issue (was only working for create)",
        "Added parentKey to IssueUpdate interface and buildUpdatePayload",
        "Supports linking Stories/Tasks to Epics via parent_key parameter",
      ],
    },
    {
      version: "1.0.13",
      date: "2025-12-05",
      changes: [
        "Changed default to sequential requests (maxConcurrent=1) - one request must complete before next starts",
        "Prevents API flooding and connection issues with strict request ordering",
      ],
    },
    {
      version: "1.0.12",
      date: "2025-12-05",
      changes: [
        "Added structured JSON logging with correlation IDs",
        "Added request/response timing metrics",
        "Added jira_get_metrics tool for observability",
        "Configurable log levels via JIRA_LOG_LEVEL env var (DEBUG/INFO/WARN/ERROR)",
        "All logs output to stderr (MCP compatible)",
      ],
    },
    {
      version: "1.0.11",
      date: "2025-12-05",
      changes: [
        "Added operation verification with assertions",
        "Added bulk operation methods with verification (bulkCreateIssues, bulkMoveToSprintWithVerification, bulkTransitionIssues)",
        "Added OperationVerifier with configurable retry and delay settings",
      ],
    },
    {
      version: "1.0.10",
      date: "2025-12-05",
      changes: [
        "Added rate limiting with configurable throttling (max 5 concurrent requests)",
        "Added automatic retry with exponential backoff for 429/5xx/network errors",
        "Added request queuing to prevent API flooding",
        "Added rate limit header monitoring (X-RateLimit-Remaining, Retry-After)",
        "Configurable via env vars: JIRA_MAX_CONCURRENT, JIRA_MAX_RETRIES, JIRA_REQUEST_DELAY_MS",
      ],
    },
    {
      version: "1.0.9",
      date: "2025-12-05",
      changes: [
        "Fixed jira_complete_sprint - now includes startDate/endDate (Jira API requires all fields)",
      ],
    },
    {
      version: "1.0.8",
      date: "2025-12-05",
      changes: [
        "Fixed jira_start_sprint - now fetches sprint name before updating state (Jira API requires name)",
        "Fixed jira_complete_sprint - same fix for sprint name requirement",
      ],
    },
    {
      version: "1.0.7",
      date: "2025-12-05",
      changes: [
        "Fixed jira_search_issues pagination - uses nextPageToken instead of deprecated startAt",
      ],
    },
    {
      version: "1.0.6",
      date: "2025-12-05",
      changes: [
        "Fixed jira_search_issues - migrated from deprecated /search to /search/jql API",
        "Fixed jira_get_field_configuration - now uses correct list endpoint with id filter",
      ],
    },
    {
      version: "1.0.5",
      date: "2025-12-05",
      changes: [
        "Added jira_suggest_project wizard tool for interactive project creation",
        "Generates project name and key suggestions from repository name",
      ],
    },
    {
      version: "1.0.4",
      date: "2025-12-05",
      changes: [
        "Added jira_create_project tool with auto-fetch current user as lead",
        "Added jira_delete_project tool",
        "Added jira_validate_project_key tool",
        "Added jira_mcp_version tool with changelog",
      ],
    },
    {
      version: "1.0.3",
      date: "2025-12-05",
      changes: [
        "Added jira_delete_project tool",
      ],
    },
    {
      version: "1.0.2",
      date: "2025-12-05",
      changes: [
        "Added jira_create_project tool",
        "Added jira_validate_project_key tool",
        "Added ProjectTemplate and ProjectTypeKey enums",
      ],
    },
    {
      version: "1.0.1",
      date: "2025-12-04",
      changes: [
        "Added field configuration tools (jira_list_field_configurations, jira_get_field_configuration, etc.)",
        "Added jira_get_create_meta tool for issue creation metadata",
      ],
    },
    {
      version: "1.0.0",
      date: "2025-12-04",
      changes: [
        "Initial release with full Jira Cloud support",
        "Issue CRUD operations",
        "Sprint management",
        "Board operations",
        "User management",
      ],
    },
  ],
};

// Initialize Jira client
let jiraClient: JiraClient;

try {
  jiraClient = new JiraClient();
} catch (error) {
  console.error("Failed to initialize Jira client:", error);
  process.exit(1);
}

// Define MCP tools
const tools: Tool[] = [
  // ==================== Issue Tools ====================
  {
    name: "jira_get_issue",
    description: "Get detailed information about a specific Jira issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_create_issue",
    description: "Create a new Jira issue",
    inputSchema: {
      type: "object",
      properties: {
        project_key: {
          type: "string",
          description: "Project key (e.g., BCM)",
        },
        summary: {
          type: "string",
          description: "Issue summary/title",
        },
        description: {
          type: "string",
          description: "Issue description",
        },
        issue_type: {
          type: "string",
          description: "Issue type (Task, Bug, Story, Epic)",
          default: "Task",
        },
        priority: {
          type: "string",
          description: "Priority (Highest, High, Medium, Low, Lowest)",
        },
        assignee_id: {
          type: "string",
          description: "Assignee account ID",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Issue labels",
        },
        parent_key: {
          type: "string",
          description: "Parent issue key for subtasks",
        },
        story_points: {
          type: "number",
          description: "Story points estimate",
        },
      },
      required: ["project_key", "summary"],
    },
  },
  {
    name: "jira_update_issue",
    description: "Update an existing Jira issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        summary: {
          type: "string",
          description: "New summary",
        },
        description: {
          type: "string",
          description: "New description",
        },
        priority: {
          type: "string",
          description: "New priority",
        },
        assignee_id: {
          type: "string",
          description: "New assignee account ID (empty string to unassign)",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "New labels",
        },
        story_points: {
          type: "number",
          description: "New story points",
        },
        parent_key: {
          type: "string",
          description: "Parent issue key (e.g., Epic key for Story-Epic linking, or Task key for Subtask). Empty string to remove parent.",
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_delete_issue",
    description: "Delete a Jira issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key to delete",
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_search_issues",
    description: "Search for issues using JQL (Jira Query Language)",
    inputSchema: {
      type: "object",
      properties: {
        jql: {
          type: "string",
          description: "JQL query string (e.g., 'project = BCM AND status = \"In Progress\"')",
        },
        max_results: {
          type: "number",
          description: "Maximum results to return (default: 50)",
          default: 50,
        },
      },
      required: ["jql"],
    },
  },
  {
    name: "jira_add_comment",
    description: "Add a comment to a Jira issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        comment: {
          type: "string",
          description: "Comment text",
        },
      },
      required: ["issue_key", "comment"],
    },
  },
  {
    name: "jira_transition_issue",
    description: "Transition an issue to a new status",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        transition_name: {
          type: "string",
          description: "Target status name (e.g., 'In Progress', 'Done')",
        },
      },
      required: ["issue_key", "transition_name"],
    },
  },

  // ==================== Project Tools ====================
  {
    name: "jira_list_projects",
    description: "List all accessible Jira projects",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_get_project",
    description: "Get details of a specific project",
    inputSchema: {
      type: "object",
      properties: {
        project_key: {
          type: "string",
          description: "Project key (e.g., BCM)",
        },
      },
      required: ["project_key"],
    },
  },
  {
    name: "jira_create_project",
    description: "Create a new Jira project with specified template (Scrum, Kanban, or Basic)",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Project key (2-10 uppercase letters, e.g., BCM)",
        },
        name: {
          type: "string",
          description: "Project name",
        },
        description: {
          type: "string",
          description: "Project description",
        },
        lead_account_id: {
          type: "string",
          description: "Account ID of the project lead (use jira_get_current_user or jira_search_users to find)",
        },
        project_type: {
          type: "string",
          enum: ["software", "business", "service_desk"],
          description: "Project type (default: software)",
        },
        template: {
          type: "string",
          enum: ["scrum", "kanban", "basic", "scrum_classic", "kanban_classic"],
          description: "Project template (default: scrum)",
        },
      },
      required: ["key", "name"],
    },
  },
  {
    name: "jira_validate_project_key",
    description: "Validate if a project key is available and valid",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Project key to validate (e.g., BCM)",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "jira_delete_project",
    description: "Delete a Jira project. Warning: This is irreversible!",
    inputSchema: {
      type: "object",
      properties: {
        project_key: {
          type: "string",
          description: "Project key or ID to delete (e.g., BCM)",
        },
      },
      required: ["project_key"],
    },
  },

  // ==================== Sprint Tools ====================
  {
    name: "jira_list_sprints",
    description: "List sprints for a board",
    inputSchema: {
      type: "object",
      properties: {
        board_id: {
          type: "number",
          description: "Board ID",
        },
        state: {
          type: "string",
          enum: ["future", "active", "closed"],
          description: "Filter by sprint state",
        },
      },
      required: ["board_id"],
    },
  },
  {
    name: "jira_get_sprint",
    description: "Get details of a specific sprint",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: {
          type: "number",
          description: "Sprint ID",
        },
      },
      required: ["sprint_id"],
    },
  },
  {
    name: "jira_create_sprint",
    description: "Create a new sprint",
    inputSchema: {
      type: "object",
      properties: {
        board_id: {
          type: "number",
          description: "Board ID",
        },
        name: {
          type: "string",
          description: "Sprint name",
        },
        start_date: {
          type: "string",
          description: "Start date (YYYY-MM-DD)",
        },
        end_date: {
          type: "string",
          description: "End date (YYYY-MM-DD)",
        },
        goal: {
          type: "string",
          description: "Sprint goal",
        },
      },
      required: ["board_id", "name"],
    },
  },
  {
    name: "jira_update_sprint",
    description: "Update an existing sprint",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: {
          type: "number",
          description: "Sprint ID",
        },
        name: {
          type: "string",
          description: "New name",
        },
        start_date: {
          type: "string",
          description: "New start date (YYYY-MM-DD)",
        },
        end_date: {
          type: "string",
          description: "New end date (YYYY-MM-DD)",
        },
        goal: {
          type: "string",
          description: "New sprint goal",
        },
      },
      required: ["sprint_id"],
    },
  },
  {
    name: "jira_start_sprint",
    description: "Start a sprint",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: {
          type: "number",
          description: "Sprint ID",
        },
        start_date: {
          type: "string",
          description: "Start date (YYYY-MM-DD)",
        },
        end_date: {
          type: "string",
          description: "End date (YYYY-MM-DD)",
        },
      },
      required: ["sprint_id", "start_date", "end_date"],
    },
  },
  {
    name: "jira_complete_sprint",
    description: "Complete/close a sprint",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: {
          type: "number",
          description: "Sprint ID",
        },
      },
      required: ["sprint_id"],
    },
  },
  {
    name: "jira_delete_sprint",
    description: "Delete a sprint",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: {
          type: "number",
          description: "Sprint ID",
        },
      },
      required: ["sprint_id"],
    },
  },
  {
    name: "jira_get_sprint_issues",
    description: "Get all issues in a sprint",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: {
          type: "number",
          description: "Sprint ID",
        },
      },
      required: ["sprint_id"],
    },
  },
  {
    name: "jira_move_issues_to_sprint",
    description: "Move issues to a sprint",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: {
          type: "number",
          description: "Target sprint ID",
        },
        issue_keys: {
          type: "array",
          items: { type: "string" },
          description: "Issue keys to move",
        },
      },
      required: ["sprint_id", "issue_keys"],
    },
  },

  // ==================== Board Tools ====================
  {
    name: "jira_list_boards",
    description: "List all boards, optionally filtered by project",
    inputSchema: {
      type: "object",
      properties: {
        project_key: {
          type: "string",
          description: "Filter by project key",
        },
      },
    },
  },
  {
    name: "jira_get_board",
    description: "Get details of a specific board",
    inputSchema: {
      type: "object",
      properties: {
        board_id: {
          type: "number",
          description: "Board ID",
        },
      },
      required: ["board_id"],
    },
  },

  // ==================== User Tools ====================
  {
    name: "jira_get_current_user",
    description: "Get information about the authenticated user",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_search_users",
    description: "Search for users by name or email",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
    },
  },

  // ==================== Field Configuration Tools ====================
  {
    name: "jira_get_create_meta",
    description: "Get field metadata for issue creation, showing which fields are required, optional, and their allowed values",
    inputSchema: {
      type: "object",
      properties: {
        project_key: {
          type: "string",
          description: "Project key (e.g., MGMT)",
        },
        issue_type: {
          type: "string",
          description: "Optional issue type name to filter results (e.g., Task, Story, Bug)",
        },
      },
      required: ["project_key"],
    },
  },
  {
    name: "jira_list_field_configurations",
    description: "List all field configurations in the Jira instance",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_get_field_configuration",
    description: "Get details of a specific field configuration",
    inputSchema: {
      type: "object",
      properties: {
        config_id: {
          type: "string",
          description: "Field configuration ID",
        },
      },
      required: ["config_id"],
    },
  },
  {
    name: "jira_get_field_configuration_items",
    description: "Get field configuration items showing which fields are required/optional/hidden",
    inputSchema: {
      type: "object",
      properties: {
        config_id: {
          type: "string",
          description: "Field configuration ID",
        },
      },
      required: ["config_id"],
    },
  },
  {
    name: "jira_update_field_configuration_item",
    description: "Update a field configuration item to make a field required, optional, or hidden",
    inputSchema: {
      type: "object",
      properties: {
        config_id: {
          type: "string",
          description: "Field configuration ID",
        },
        field_id: {
          type: "string",
          description: "Field ID (e.g., customfield_10016 for story points)",
        },
        is_required: {
          type: "boolean",
          description: "Whether the field is required",
        },
        is_hidden: {
          type: "boolean",
          description: "Whether the field is hidden",
        },
        description: {
          type: "string",
          description: "Optional description for the field",
        },
      },
      required: ["config_id", "field_id"],
    },
  },

  // ==================== MCP Info Tools ====================
  {
    name: "jira_mcp_version",
    description: "Get the current version and changelog of the Bodywave Jira MCP server",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_get_metrics",
    description: "Get API request metrics including success rate, average latency, top endpoints, and error types. Useful for monitoring and debugging.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ==================== Wizard Tools ====================
  {
    name: "jira_suggest_project",
    description: "Generate project name and key suggestions based on a repository name. Use this before jira_create_project to provide a wizard-like experience. The AI should detect the repo name (e.g., via `basename $(git rev-parse --show-toplevel)`) and pass it here.",
    inputSchema: {
      type: "object",
      properties: {
        repo_name: {
          type: "string",
          description: "Repository name (e.g., 'chamama-booking-app'). The tool will generate suggestions based on this.",
        },
      },
      required: ["repo_name"],
    },
  },

  // ==================== DevOps Workflow Tools ====================
  {
    name: "jira_epic_workflow",
    description: `Generate opinionated Git workflow metadata for an EPIC-based PR.

This tool fetches an EPIC and all its child tasks, then generates:
- Branch name: feature/{EPIC-KEY}-{slug}
- Commit message templates for each task: {TASK-KEY}: {summary}
- PR title and body with task checklist

**Workflow:**
1. Call this tool with an EPIC key
2. Create the suggested branch: git checkout -b {branch_name}
3. Stage and commit files using the suggested commit messages
4. Create PR with the suggested title and body
5. After merge, transition tasks to Done

**Conventions:**
- One PR per EPIC (aggregates all related tasks)
- Branch: feature/{EPIC-KEY}-{lowercase-slug}
- Commits: {TASK-KEY}: {description}
- PR links back to EPIC and lists all tasks`,
    inputSchema: {
      type: "object",
      properties: {
        epic_key: {
          type: "string",
          description: "The EPIC issue key (e.g., MGMT-44)",
        },
        base_branch: {
          type: "string",
          description: "Base branch to merge into (default: main)",
          default: "main",
        },
      },
      required: ["epic_key"],
    },
  },
];

// Helper function to generate project suggestions from repo name
function generateProjectSuggestions(repoName: string): {
  suggested_name: string;
  suggested_key: string;
  suggested_key_alternatives: string[];
  template_options: { value: string; label: string; description: string }[];
  instructions: string;
} {
  // Normalize repo name: replace dashes/underscores with spaces, uppercase
  const normalizedName = repoName
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  const suggestedName = repoName.toUpperCase().replace(/-/g, "-");

  // Generate key: take first letter of each word, max 10 chars
  const words = repoName.replace(/[-_]/g, " ").split(" ");
  const primaryKey = words
    .map((w) => w.charAt(0).toUpperCase())
    .join("")
    .slice(0, 10);

  // Alternative keys
  const alternatives: string[] = [];

  // First 3-4 letters of first word
  if (words[0] && words[0].length >= 3) {
    alternatives.push(words[0].slice(0, 4).toUpperCase());
  }

  // First word + first letter of second
  if (words.length >= 2) {
    alternatives.push((words[0].slice(0, 3) + words[1].charAt(0)).toUpperCase());
  }

  // Full acronym if different from primary
  const fullAcronym = words.map((w) => w.charAt(0).toUpperCase()).join("");
  if (fullAcronym !== primaryKey && fullAcronym.length >= 2) {
    alternatives.push(fullAcronym);
  }

  return {
    suggested_name: suggestedName,
    suggested_key: primaryKey.length >= 2 ? primaryKey : repoName.slice(0, 4).toUpperCase(),
    suggested_key_alternatives: [...new Set(alternatives)].filter((k) => k !== primaryKey && k.length >= 2),
    template_options: [
      { value: "scrum", label: "Scrum", description: "Agile development with sprints, backlogs, and velocity tracking" },
      { value: "kanban", label: "Kanban", description: "Continuous flow with WIP limits and visual board" },
      { value: "basic", label: "Basic", description: "Simple project without agile features" },
    ],
    instructions: `To create this project, confirm or modify these values, then I'll call jira_create_project with your choices.`,
  };
}

// Helper types for epic workflow
interface EpicWorkflowTask {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  storyPoints?: number;
  commitMessage: string;
}

interface EpicWorkflowResult {
  epic: {
    key: string;
    summary: string;
    status: string;
    url: string;
  };
  tasks: EpicWorkflowTask[];
  git: {
    branchName: string;
    branchCommand: string;
  };
  pr: {
    title: string;
    body: string;
  };
  postMerge: {
    tasksToTransition: string[];
    transitionCommand: string;
  };
  instructions: string[];
}

// Helper function to generate slug from text
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// Helper function to generate epic workflow metadata
async function generateEpicWorkflow(
  epicKey: string,
  baseBranch: string
): Promise<EpicWorkflowResult> {
  // Fetch the EPIC
  const epic = await jiraClient.getIssue(epicKey);

  if (epic.issueType !== "Epic") {
    throw new Error(`${epicKey} is not an Epic (found: ${epic.issueType})`);
  }

  // Fetch all child tasks
  const searchResult = await jiraClient.searchIssues(
    `parent = ${epicKey} ORDER BY created ASC`,
    100
  );

  const tasks: EpicWorkflowTask[] = searchResult.issues.map((issue) => ({
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    issueType: issue.issueType,
    storyPoints: issue.storyPoints,
    commitMessage: `${issue.key}: ${issue.summary}`,
  }));

  // Generate branch name
  const slug = slugify(epic.summary);
  const branchName = `feature/${epicKey.toLowerCase()}-${slug}`;

  // Generate PR body with markdown checklist
  const taskList = tasks
    .map((t) => {
      const status = t.status === "Done" ? "x" : " ";
      const points = t.storyPoints ? ` (${t.storyPoints}pt)` : "";
      return `- [${status}] **${t.key}**: ${t.summary}${points}`;
    })
    .join("\n");

  const totalPoints = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
  const doneCount = tasks.filter((t) => t.status === "Done").length;

  // Get Jira base URL from config
  const jiraUrl = process.env.JIRA_URL || "https://bodywave.atlassian.net";
  const epicUrl = `${jiraUrl}/browse/${epicKey}`;

  const prBody = `## Summary

This PR implements **[${epicKey}](${epicUrl}): ${epic.summary}**

## Tasks

${taskList}

**Progress:** ${doneCount}/${tasks.length} tasks | **Story Points:** ${totalPoints}

## Links

- Epic: [${epicKey}](${epicUrl})
- Project: ${epic.projectKey}

---
🤖 Generated with [Bodywave Jira MCP](https://github.com/bodywave/jira-mcp)`;

  // Tasks that need transitioning after merge
  const tasksToTransition = tasks
    .filter((t) => t.status !== "Done")
    .map((t) => t.key);

  return {
    epic: {
      key: epic.key,
      summary: epic.summary,
      status: epic.status,
      url: epicUrl,
    },
    tasks,
    git: {
      branchName,
      branchCommand: `git checkout -b ${branchName}`,
    },
    pr: {
      title: `[${epicKey}] ${epic.summary}`,
      body: prBody,
    },
    postMerge: {
      tasksToTransition,
      transitionCommand: tasksToTransition.length > 0
        ? `# Transition tasks to Done after merge:\n${tasksToTransition.map((k) => `jira_transition_issue(issue_key="${k}", transition_name="Done")`).join("\n")}`
        : "# All tasks already Done - no transitions needed",
    },
    instructions: [
      `1. Create branch: git checkout -b ${branchName}`,
      `2. Stage your changes and commit using task keys:`,
      ...tasks.slice(0, 3).map((t) => `   git commit -m "${t.commitMessage}"`),
      tasks.length > 3 ? `   ... (${tasks.length - 3} more tasks)` : "",
      `3. Push branch: git push -u origin ${branchName}`,
      `4. Create PR: gh pr create --title "[${epicKey}] ${epic.summary}" --body "..."`,
      `5. After CI passes and PR is merged, transition remaining tasks to Done`,
    ].filter(Boolean),
  };
}

// Tool handler
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  try {
    switch (name) {
      // Issue tools
      case "jira_get_issue":
        return await jiraClient.getIssue(args.issue_key as string);

      case "jira_create_issue":
        return await jiraClient.createIssue({
          projectKey: args.project_key as string,
          summary: args.summary as string,
          description: args.description as string | undefined,
          issueType: args.issue_type as string | undefined,
          priority: args.priority as string | undefined,
          assigneeId: args.assignee_id as string | undefined,
          labels: args.labels as string[] | undefined,
          parentKey: args.parent_key as string | undefined,
          storyPoints: args.story_points as number | undefined,
        });

      case "jira_update_issue":
        return await jiraClient.updateIssue(args.issue_key as string, {
          summary: args.summary as string | undefined,
          description: args.description as string | undefined,
          priority: args.priority as string | undefined,
          assigneeId: args.assignee_id as string | undefined,
          labels: args.labels as string[] | undefined,
          storyPoints: args.story_points as number | undefined,
          parentKey: args.parent_key as string | undefined,
        });

      case "jira_delete_issue":
        await jiraClient.deleteIssue(args.issue_key as string);
        return { success: true, message: `Issue ${args.issue_key} deleted` };

      case "jira_search_issues":
        return await jiraClient.searchIssues(
          args.jql as string,
          args.max_results as number | undefined
        );

      case "jira_add_comment":
        return await jiraClient.addComment(
          args.issue_key as string,
          args.comment as string
        );

      case "jira_transition_issue": {
        const transitions = await jiraClient.getTransitions(args.issue_key as string);
        const targetTransition = transitions.find(
          (t) => t.name.toLowerCase() === (args.transition_name as string).toLowerCase()
        );
        if (!targetTransition) {
          const available = transitions.map((t) => t.name).join(", ");
          throw new Error(`Transition '${args.transition_name}' not available. Available: ${available}`);
        }
        await jiraClient.transitionIssue(args.issue_key as string, targetTransition.id);
        return { success: true, message: `Issue transitioned to '${args.transition_name}'` };
      }

      // Project tools
      case "jira_list_projects":
        return await jiraClient.listProjects();

      case "jira_get_project":
        return await jiraClient.getProject(args.project_key as string);

      case "jira_create_project": {
        const templateMap: Record<string, ProjectTemplate> = {
          scrum: ProjectTemplate.SCRUM,
          kanban: ProjectTemplate.KANBAN,
          basic: ProjectTemplate.BASIC,
          scrum_classic: ProjectTemplate.SCRUM_CLASSIC,
          kanban_classic: ProjectTemplate.KANBAN_CLASSIC,
        };

        const typeMap: Record<string, ProjectTypeKey> = {
          software: ProjectTypeKey.SOFTWARE,
          business: ProjectTypeKey.BUSINESS,
          service_desk: ProjectTypeKey.SERVICE_DESK,
        };

        return await jiraClient.createProject({
          key: args.key as string,
          name: args.name as string,
          description: args.description as string | undefined,
          leadAccountId: args.lead_account_id as string | undefined,
          projectTypeKey: args.project_type ? typeMap[args.project_type as string] : undefined,
          projectTemplateKey: args.template ? templateMap[args.template as string] : undefined,
        });
      }

      case "jira_validate_project_key":
        return await jiraClient.validateProjectKey(args.key as string);

      case "jira_delete_project":
        return await jiraClient.deleteProject(args.project_key as string);

      // Sprint tools
      case "jira_list_sprints":
        return await jiraClient.listSprintsForBoard(
          args.board_id as number,
          args.state as SprintState | undefined
        );

      case "jira_get_sprint":
        return await jiraClient.getSprint(args.sprint_id as number);

      case "jira_create_sprint":
        return await jiraClient.createSprint({
          boardId: args.board_id as number,
          name: args.name as string,
          startDate: args.start_date as string | undefined,
          endDate: args.end_date as string | undefined,
          goal: args.goal as string | undefined,
        });

      case "jira_update_sprint":
        return await jiraClient.updateSprint(args.sprint_id as number, {
          name: args.name as string | undefined,
          startDate: args.start_date as string | undefined,
          endDate: args.end_date as string | undefined,
          goal: args.goal as string | undefined,
        });

      case "jira_start_sprint":
        return await jiraClient.startSprint(
          args.sprint_id as number,
          args.start_date as string,
          args.end_date as string
        );

      case "jira_complete_sprint":
        return await jiraClient.completeSprint(args.sprint_id as number);

      case "jira_delete_sprint":
        await jiraClient.deleteSprint(args.sprint_id as number);
        return { success: true, message: `Sprint ${args.sprint_id} deleted` };

      case "jira_get_sprint_issues":
        return await jiraClient.getSprintIssues(args.sprint_id as number);

      case "jira_move_issues_to_sprint":
        await jiraClient.moveIssuesToSprint(
          args.sprint_id as number,
          args.issue_keys as string[]
        );
        return {
          success: true,
          message: `Moved ${(args.issue_keys as string[]).length} issues to sprint ${args.sprint_id}`,
        };

      // Board tools
      case "jira_list_boards":
        return await jiraClient.listBoards(args.project_key as string | undefined);

      case "jira_get_board":
        return await jiraClient.getBoard(args.board_id as number);

      // User tools
      case "jira_get_current_user":
        return await jiraClient.getCurrentUser();

      case "jira_search_users":
        return await jiraClient.searchUsers(args.query as string);

      // Field Configuration tools
      case "jira_get_create_meta":
        return await jiraClient.getCreateMeta(
          args.project_key as string,
          args.issue_type as string | undefined
        );

      case "jira_list_field_configurations":
        return await jiraClient.getFieldConfigurations();

      case "jira_get_field_configuration":
        return await jiraClient.getFieldConfiguration(args.config_id as string);

      case "jira_get_field_configuration_items":
        return await jiraClient.getFieldConfigurationItems(args.config_id as string);

      case "jira_update_field_configuration_item": {
        const updates: Partial<{ isRequired: boolean; isHidden: boolean; description: string }> = {};
        if (args.is_required !== undefined) updates.isRequired = args.is_required as boolean;
        if (args.is_hidden !== undefined) updates.isHidden = args.is_hidden as boolean;
        if (args.description !== undefined) updates.description = args.description as string;

        await jiraClient.updateFieldConfigurationItem(
          args.config_id as string,
          args.field_id as string,
          updates
        );
        return {
          success: true,
          message: `Field ${args.field_id} updated in configuration ${args.config_id}`,
        };
      }

      // MCP Info tools
      case "jira_mcp_version":
        return VERSION_INFO;

      case "jira_get_metrics":
        return logger.getMetricsSummary();

      // Wizard tools
      case "jira_suggest_project":
        return generateProjectSuggestions(args.repo_name as string);

      // DevOps Workflow tools
      case "jira_epic_workflow":
        return await generateEpicWorkflow(
          args.epic_key as string,
          (args.base_branch as string) || "main"
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof JiraClientError) {
      return {
        error: true,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
      };
    }
    throw error;
  }
}

// Create and start the MCP server
const server = new Server(
  {
    name: "bodywave-jira",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleToolCall(name, args as Record<string, unknown>);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bodywave Jira MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
