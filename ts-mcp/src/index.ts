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
 *   - JIRA_URL: Jira instance URL (e.g., https://your-domain.atlassian.net)
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
import { JiraClientError } from "./jira-client.js";
import { ConfluenceClientError } from "./confluence-client.js";
import { SprintState, ProjectTemplate, ProjectTypeKey } from "./types.js";
import { ConfluencePageStatus, ConfluenceBodyFormat } from "./confluence-types.js";
import { accountManager } from "./account-manager.js";

import { logger } from "./logger.js";

// Version and changelog info
const VERSION_INFO = {
  version: "1.1.1",
  name: "@bodywave/jira-mcp",
  description: "MCP server for Jira and Confluence with full sprint management, bulk operations, and multi-account support",
  changelog: [
    {
      version: "1.1.1",
      date: "2026-02-02",
      changes: [
        "Added Confluence integration with 27 new tools",
        "Confluence tools: spaces, pages, search, comments, labels, attachments, content properties",
        "Same credentials work for both Jira and Confluence (no new env vars)",
        "Dual API version support: v2 for most operations, v1 for search/CQL, label writes, attachment uploads",
        "Cursor-based pagination for all Confluence list operations",
        "Auto version increment on page and comment updates",
      ],
    },
    {
      version: "1.0.25",
      date: "2025-12-05",
      changes: [
        "Added enhanced comment operations",
        "New tools: jira_get_comments, jira_get_comment, jira_update_comment, jira_delete_comment",
        "Full CRUD support for issue comments with pagination",
      ],
    },
    {
      version: "1.0.24",
      date: "2025-12-05",
      changes: [
        "Added JQL filter management support",
        "New tools: jira_list_filters, jira_get_filter, jira_search_filters, jira_create_filter",
        "New tools: jira_update_filter, jira_delete_filter, jira_set_filter_favourite, jira_get_favourite_filters",
        "New tool: jira_execute_filter - execute saved filters and return matching issues",
        "Support for filter sharing permissions and favourites",
      ],
    },
    {
      version: "1.0.23",
      date: "2025-12-05",
      changes: [
        "Added sprint analytics and velocity reporting",
        "New tools: jira_get_sprint_report, jira_get_sprint_velocity, jira_get_velocity_report, jira_get_sprint_burndown",
        "Sprint reports with completed/incomplete issues and completion rates",
        "Velocity tracking across multiple sprints with trend detection",
        "Burndown charts with ideal line and actual progress",
      ],
    },
    {
      version: "1.0.22",
      date: "2025-12-05",
      changes: [
        "Added issue linking support",
        "New tools: jira_list_issue_link_types, jira_get_issue_links, jira_create_issue_link, jira_delete_issue_link",
        "Support for all link types: Blocks, Relates, Duplicate, Cloners",
        "Create links between issues with optional comments",
        "Added IssueLinkTypeName enum for common link types",
      ],
    },
    {
      version: "1.0.21",
      date: "2025-12-05",
      changes: [
        "Added bulk issue operations with verification",
        "New tools: jira_bulk_transition_issues, jira_bulk_update_issues, jira_bulk_delete_issues",
        "New tools: jira_bulk_move_to_sprint, jira_bulk_add_labels, jira_bulk_assign_issues",
        "All bulk operations include verification to confirm success",
        "Detailed operation results with succeeded/failed counts",
      ],
    },
    {
      version: "1.0.20",
      date: "2025-12-05",
      changes: [
        "Added webhook management support",
        "New tools: jira_list_webhooks, jira_get_webhook, jira_create_webhook, jira_delete_webhooks",
        "New tools: jira_refresh_webhooks, jira_get_failed_webhooks",
        "Support for webhook registration, refresh, and monitoring failed callbacks",
        "Added WebhookEvent enum with common Jira webhook events",
      ],
    },
    {
      version: "1.0.19",
      date: "2025-12-05",
      changes: [
        "Added file attachment support",
        "New tools: jira_get_attachments, jira_add_attachment, jira_delete_attachment, jira_get_attachment",
        "Support for uploading files via base64 encoding",
        "Added form-data dependency for multipart uploads",
      ],
    },
    {
      version: "1.0.18",
      date: "2025-12-05",
      changes: [
        "Added time tracking and worklog support",
        "New tools: jira_get_worklogs, jira_add_worklog, jira_update_worklog, jira_delete_worklog",
        "New tools: jira_get_time_tracking, jira_set_time_tracking",
        "Support for logging work time and setting estimates on issues",
      ],
    },
    {
      version: "1.0.17",
      date: "2025-12-05",
      changes: [
        "Added custom field support",
        "New tools: jira_list_fields, jira_list_custom_fields, jira_get_field, jira_get_field_options",
        "New tools: jira_get_issue_field_value, jira_set_issue_field_value, jira_get_issue_custom_fields",
        "Support for reading/writing any custom field on issues",
      ],
    },
    {
      version: "1.0.16",
      date: "2025-12-05",
      changes: [
        "Added multi-account management support",
        "New tools: jira_list_accounts, jira_add_account, jira_remove_account, jira_switch_account, jira_test_account",
        "Runtime account switching without server restart",
        "Account credentials stored securely in-memory",
        "Backwards compatible - default account from env vars works as before",
      ],
    },
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

// Get active Jira client from account manager
function getJiraClient() {
  return accountManager.getActiveClient();
}

// Get active Confluence client from account manager
function getConfluenceClient() {
  return accountManager.getActiveConfluenceClient();
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
    name: "jira_get_comments",
    description: "Get all comments for an issue with pagination support",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of comments to return (default: 50)",
          default: 50,
        },
        start_at: {
          type: "number",
          description: "Index of the first comment to return (default: 0)",
          default: 0,
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_get_comment",
    description: "Get a specific comment by ID",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        comment_id: {
          type: "string",
          description: "Comment ID",
        },
      },
      required: ["issue_key", "comment_id"],
    },
  },
  {
    name: "jira_update_comment",
    description: "Update an existing comment",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        comment_id: {
          type: "string",
          description: "Comment ID to update",
        },
        comment: {
          type: "string",
          description: "New comment text",
        },
      },
      required: ["issue_key", "comment_id", "comment"],
    },
  },
  {
    name: "jira_delete_comment",
    description: "Delete a comment from an issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        comment_id: {
          type: "string",
          description: "Comment ID to delete",
        },
      },
      required: ["issue_key", "comment_id"],
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

  // ==================== Sprint Analytics Tools ====================
  {
    name: "jira_get_sprint_report",
    description: "Get a comprehensive sprint report with completed/incomplete issues and completion rates",
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
    name: "jira_get_sprint_velocity",
    description: "Get velocity data for a single sprint (completed vs committed points)",
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
    name: "jira_get_velocity_report",
    description: "Get velocity report for a board showing trends across multiple sprints",
    inputSchema: {
      type: "object",
      properties: {
        board_id: {
          type: "number",
          description: "Board ID",
        },
        sprint_count: {
          type: "number",
          description: "Number of recent sprints to include (default: 5)",
          default: 5,
        },
      },
      required: ["board_id"],
    },
  },
  {
    name: "jira_get_sprint_burndown",
    description: "Get burndown data for a sprint with ideal line and actual progress",
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

  // ==================== Custom Field Tools ====================
  {
    name: "jira_list_fields",
    description: "List all fields (system and custom) in Jira",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_list_custom_fields",
    description: "List only custom fields in Jira",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_get_field",
    description: "Get details about a specific field",
    inputSchema: {
      type: "object",
      properties: {
        field_id: {
          type: "string",
          description: "Field ID (e.g., customfield_10016) or key",
        },
      },
      required: ["field_id"],
    },
  },
  {
    name: "jira_get_field_options",
    description: "Get available options for a select/multi-select custom field",
    inputSchema: {
      type: "object",
      properties: {
        field_id: {
          type: "string",
          description: "Custom field ID (e.g., customfield_10020)",
        },
        context_id: {
          type: "string",
          description: "Optional context ID to filter options",
        },
      },
      required: ["field_id"],
    },
  },
  {
    name: "jira_get_issue_field_value",
    description: "Get the value of a specific field on an issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        field_id: {
          type: "string",
          description: "Field ID (e.g., customfield_10016)",
        },
      },
      required: ["issue_key", "field_id"],
    },
  },
  {
    name: "jira_set_issue_field_value",
    description: "Set the value of a specific field on an issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        field_id: {
          type: "string",
          description: "Field ID (e.g., customfield_10016)",
        },
        value: {
          description: "Value to set (type depends on field: string, number, object, array)",
        },
      },
      required: ["issue_key", "field_id", "value"],
    },
  },
  {
    name: "jira_get_issue_custom_fields",
    description: "Get all custom field values for an issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        field_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of specific field IDs to retrieve",
        },
      },
      required: ["issue_key"],
    },
  },

  // ==================== Time Tracking Tools ====================
  {
    name: "jira_get_worklogs",
    description: "Get all worklogs (time entries) for an issue",
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
    name: "jira_add_worklog",
    description: "Add a worklog (time entry) to an issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        time_spent: {
          type: "string",
          description: "Time spent in Jira format (e.g., '3h 30m', '1d', '2w')",
        },
        time_spent_seconds: {
          type: "number",
          description: "Time spent in seconds (alternative to time_spent)",
        },
        started: {
          type: "string",
          description: "When the work started (ISO 8601 format, e.g., '2025-12-05T09:00:00.000+0000')",
        },
        comment: {
          type: "string",
          description: "Description of work done",
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_update_worklog",
    description: "Update an existing worklog",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        worklog_id: {
          type: "string",
          description: "Worklog ID to update",
        },
        time_spent: {
          type: "string",
          description: "New time spent in Jira format",
        },
        time_spent_seconds: {
          type: "number",
          description: "New time spent in seconds",
        },
        started: {
          type: "string",
          description: "New start time (ISO 8601 format)",
        },
        comment: {
          type: "string",
          description: "New description of work done",
        },
      },
      required: ["issue_key", "worklog_id"],
    },
  },
  {
    name: "jira_delete_worklog",
    description: "Delete a worklog from an issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        worklog_id: {
          type: "string",
          description: "Worklog ID to delete",
        },
      },
      required: ["issue_key", "worklog_id"],
    },
  },
  {
    name: "jira_get_time_tracking",
    description: "Get time tracking information (estimates and logged time) for an issue",
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
    name: "jira_set_time_tracking",
    description: "Set time tracking estimates on an issue",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        original_estimate: {
          type: "string",
          description: "Original time estimate (e.g., '2d', '8h')",
        },
        remaining_estimate: {
          type: "string",
          description: "Remaining time estimate (e.g., '1d', '4h')",
        },
      },
      required: ["issue_key"],
    },
  },

  // ==================== Attachment Tools ====================
  {
    name: "jira_get_attachments",
    description: "Get all attachments for an issue",
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
    name: "jira_add_attachment",
    description: "Add an attachment to an issue. Content should be base64 encoded.",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g., BCM-123)",
        },
        filename: {
          type: "string",
          description: "Name of the file to attach",
        },
        content_base64: {
          type: "string",
          description: "File content encoded as base64",
        },
      },
      required: ["issue_key", "filename", "content_base64"],
    },
  },
  {
    name: "jira_delete_attachment",
    description: "Delete an attachment from Jira",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description: "Attachment ID to delete",
        },
      },
      required: ["attachment_id"],
    },
  },
  {
    name: "jira_get_attachment",
    description: "Get metadata for a specific attachment",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description: "Attachment ID",
        },
      },
      required: ["attachment_id"],
    },
  },

  // ==================== Webhook Tools ====================
  {
    name: "jira_list_webhooks",
    description: "List all webhooks registered for this Jira instance",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_get_webhook",
    description: "Get details of a specific webhook by ID",
    inputSchema: {
      type: "object",
      properties: {
        webhook_id: {
          type: "number",
          description: "Webhook ID",
        },
      },
      required: ["webhook_id"],
    },
  },
  {
    name: "jira_create_webhook",
    description: "Register a new webhook. Note: Requires Connect app or OAuth 2.0 scope.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the webhook",
        },
        url: {
          type: "string",
          description: "URL to receive webhook callbacks",
        },
        events: {
          type: "array",
          items: { type: "string" },
          description: "Events to subscribe to (e.g., 'jira:issue_created', 'jira:issue_updated')",
        },
        jql_filter: {
          type: "string",
          description: "Optional JQL filter to restrict which issues trigger the webhook",
        },
      },
      required: ["name", "url", "events"],
    },
  },
  {
    name: "jira_delete_webhooks",
    description: "Delete one or more webhooks by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        webhook_ids: {
          type: "array",
          items: { type: "number" },
          description: "Array of webhook IDs to delete",
        },
      },
      required: ["webhook_ids"],
    },
  },
  {
    name: "jira_refresh_webhooks",
    description: "Refresh webhooks to extend their expiration time",
    inputSchema: {
      type: "object",
      properties: {
        webhook_ids: {
          type: "array",
          items: { type: "number" },
          description: "Array of webhook IDs to refresh",
        },
      },
      required: ["webhook_ids"],
    },
  },
  {
    name: "jira_get_failed_webhooks",
    description: "Get list of failed webhook calls that need to be retried",
    inputSchema: {
      type: "object",
      properties: {
        after: {
          type: "number",
          description: "Optional timestamp to get failures after this time",
        },
      },
    },
  },

  // ==================== Issue Link Tools ====================
  {
    name: "jira_list_issue_link_types",
    description: "List all available issue link types (e.g., Blocks, Relates, Duplicates)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_get_issue_links",
    description: "Get all links for a specific issue",
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
    name: "jira_create_issue_link",
    description: "Create a link between two issues. Use inward_issue for the 'inward' side of the relationship and outward_issue for the 'outward' side. For example, with 'Blocks' type: outward_issue blocks inward_issue.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Link type name (e.g., 'Blocks', 'Relates', 'Duplicate', 'Cloners')",
        },
        inward_issue: {
          type: "string",
          description: "Issue key for the inward side (e.g., 'is blocked by' side)",
        },
        outward_issue: {
          type: "string",
          description: "Issue key for the outward side (e.g., 'blocks' side)",
        },
        comment: {
          type: "string",
          description: "Optional comment on the link",
        },
      },
      required: ["type", "inward_issue", "outward_issue"],
    },
  },
  {
    name: "jira_delete_issue_link",
    description: "Delete an issue link by its ID",
    inputSchema: {
      type: "object",
      properties: {
        link_id: {
          type: "string",
          description: "The issue link ID to delete",
        },
      },
      required: ["link_id"],
    },
  },

  // ==================== JQL Filter Tools ====================
  {
    name: "jira_list_filters",
    description: "List all filters owned by or shared with the current user",
    inputSchema: {
      type: "object",
      properties: {
        expand: {
          type: "string",
          description: "Optional expand parameter (e.g., 'sharedUsers,subscriptions')",
        },
      },
    },
  },
  {
    name: "jira_get_filter",
    description: "Get details of a specific filter by ID",
    inputSchema: {
      type: "object",
      properties: {
        filter_id: {
          type: "string",
          description: "Filter ID",
        },
        expand: {
          type: "string",
          description: "Optional expand parameter",
        },
      },
      required: ["filter_id"],
    },
  },
  {
    name: "jira_search_filters",
    description: "Search for filters by name",
    inputSchema: {
      type: "object",
      properties: {
        filter_name: {
          type: "string",
          description: "Name or partial name to search for",
        },
        expand: {
          type: "string",
          description: "Optional expand parameter",
        },
      },
      required: ["filter_name"],
    },
  },
  {
    name: "jira_create_filter",
    description: "Create a new JQL filter",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Filter name",
        },
        jql: {
          type: "string",
          description: "JQL query string",
        },
        description: {
          type: "string",
          description: "Filter description",
        },
        favourite: {
          type: "boolean",
          description: "Whether to mark as favourite",
        },
      },
      required: ["name", "jql"],
    },
  },
  {
    name: "jira_update_filter",
    description: "Update an existing filter",
    inputSchema: {
      type: "object",
      properties: {
        filter_id: {
          type: "string",
          description: "Filter ID to update",
        },
        name: {
          type: "string",
          description: "New filter name",
        },
        jql: {
          type: "string",
          description: "New JQL query string",
        },
        description: {
          type: "string",
          description: "New filter description",
        },
        favourite: {
          type: "boolean",
          description: "Whether to mark as favourite",
        },
      },
      required: ["filter_id"],
    },
  },
  {
    name: "jira_delete_filter",
    description: "Delete a filter",
    inputSchema: {
      type: "object",
      properties: {
        filter_id: {
          type: "string",
          description: "Filter ID to delete",
        },
      },
      required: ["filter_id"],
    },
  },
  {
    name: "jira_set_filter_favourite",
    description: "Set or unset a filter as favourite",
    inputSchema: {
      type: "object",
      properties: {
        filter_id: {
          type: "string",
          description: "Filter ID",
        },
        favourite: {
          type: "boolean",
          description: "Whether to set (true) or unset (false) as favourite",
        },
      },
      required: ["filter_id", "favourite"],
    },
  },
  {
    name: "jira_get_favourite_filters",
    description: "Get all favourite filters",
    inputSchema: {
      type: "object",
      properties: {
        expand: {
          type: "string",
          description: "Optional expand parameter",
        },
      },
    },
  },
  {
    name: "jira_execute_filter",
    description: "Execute a saved filter and return matching issues",
    inputSchema: {
      type: "object",
      properties: {
        filter_id: {
          type: "string",
          description: "Filter ID to execute",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results (default: 50)",
          default: 50,
        },
      },
      required: ["filter_id"],
    },
  },

  // ==================== Bulk Operations Tools ====================
  {
    name: "jira_bulk_transition_issues",
    description: "Transition multiple issues to a new status with verification",
    inputSchema: {
      type: "object",
      properties: {
        issue_keys: {
          type: "array",
          items: { type: "string" },
          description: "Array of issue keys to transition (e.g., ['BCM-1', 'BCM-2'])",
        },
        transition_name: {
          type: "string",
          description: "Target status name (e.g., 'In Progress', 'Done')",
        },
      },
      required: ["issue_keys", "transition_name"],
    },
  },
  {
    name: "jira_bulk_update_issues",
    description: "Update multiple issues with the same changes",
    inputSchema: {
      type: "object",
      properties: {
        issue_keys: {
          type: "array",
          items: { type: "string" },
          description: "Array of issue keys to update",
        },
        summary: {
          type: "string",
          description: "New summary for all issues",
        },
        priority: {
          type: "string",
          description: "New priority for all issues",
        },
        assignee_id: {
          type: "string",
          description: "Assignee account ID (empty string to unassign)",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "New labels to set on all issues",
        },
      },
      required: ["issue_keys"],
    },
  },
  {
    name: "jira_bulk_delete_issues",
    description: "Delete multiple issues. Warning: This is irreversible!",
    inputSchema: {
      type: "object",
      properties: {
        issue_keys: {
          type: "array",
          items: { type: "string" },
          description: "Array of issue keys to delete",
        },
      },
      required: ["issue_keys"],
    },
  },
  {
    name: "jira_bulk_move_to_sprint",
    description: "Move multiple issues to a sprint with verification",
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
          description: "Array of issue keys to move",
        },
      },
      required: ["sprint_id", "issue_keys"],
    },
  },
  {
    name: "jira_bulk_add_labels",
    description: "Add labels to multiple issues (preserves existing labels)",
    inputSchema: {
      type: "object",
      properties: {
        issue_keys: {
          type: "array",
          items: { type: "string" },
          description: "Array of issue keys",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Labels to add to all issues",
        },
      },
      required: ["issue_keys", "labels"],
    },
  },
  {
    name: "jira_bulk_assign_issues",
    description: "Assign multiple issues to the same user",
    inputSchema: {
      type: "object",
      properties: {
        issue_keys: {
          type: "array",
          items: { type: "string" },
          description: "Array of issue keys",
        },
        assignee_id: {
          type: "string",
          description: "Account ID to assign to (null or empty to unassign)",
        },
      },
      required: ["issue_keys"],
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

  // ==================== Account Management Tools ====================
  {
    name: "jira_list_accounts",
    description: "List all configured Jira accounts. Shows which account is currently active.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jira_add_account",
    description: "Add a new Jira account for multi-account management. Credentials are stored securely in-memory.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique identifier for the account (lowercase, e.g., 'mycompany', 'secondary')",
        },
        name: {
          type: "string",
          description: "Display name for the account",
        },
        url: {
          type: "string",
          description: "Jira instance URL (e.g., https://your-domain.atlassian.net)",
        },
        email: {
          type: "string",
          description: "User email for authentication",
        },
        api_key: {
          type: "string",
          description: "API token for authentication",
        },
      },
      required: ["id", "name", "url", "email", "api_key"],
    },
  },
  {
    name: "jira_remove_account",
    description: "Remove a configured Jira account. Cannot remove the only account or the active account if it's the last one.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Account ID to remove",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "jira_switch_account",
    description: "Switch to a different Jira account. All subsequent operations will use this account.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Account ID to switch to",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "jira_test_account",
    description: "Test connection to a Jira account by fetching the current user.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Account ID to test (tests active account if not provided)",
        },
      },
    },
  },

  // ==================== Confluence Space Tools ====================
  {
    name: "confluence_list_spaces",
    description:
      "List Confluence spaces (not pages — a space is a top-level container that holds pages). " +
      "Returns space id, key, name, type. " +
      "Use confluence_list_pages with space_id to get pages inside a space. " +
      "Pagination: if the response includes a 'cursor' field, pass it back as the 'cursor' parameter to get the next page of results.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["global", "personal"],
          description: "Filter by space type. 'global' = shared team spaces, 'personal' = individual user spaces.",
        },
        status: {
          type: "string",
          description: "Filter by status. Usually 'current'.",
        },
        limit: {
          type: "number",
          description: "Max results per page (default: 25, max: 250).",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor returned in the 'cursor' field of a previous response. Omit for first page.",
        },
      },
    },
  },
  {
    name: "confluence_get_space",
    description:
      "Get detailed information about a single Confluence space by its numeric ID. " +
      "To find a space ID, use confluence_list_spaces first and look at the 'id' field. " +
      "Returns: id, key, name, type, status, description, homepageId.",
    inputSchema: {
      type: "object",
      properties: {
        space_id: {
          type: "string",
          description: "Numeric space ID (e.g., '65540'). NOT the space key — use confluence_list_spaces to find the ID.",
        },
      },
      required: ["space_id"],
    },
  },
  {
    name: "confluence_create_space",
    description:
      "Create a new Confluence space. A space is a top-level container for pages. " +
      "The key must be unique across the entire Confluence instance. " +
      "After creation, use confluence_create_page with the returned space ID to add pages.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Space key — short unique identifier (e.g., 'ENG', 'HR', 'DOCS'). Uppercase letters and numbers only, max 255 chars.",
        },
        name: {
          type: "string",
          description: "Human-readable space name (e.g., 'Engineering Team').",
        },
        description: {
          type: "string",
          description: "Plain text description of the space's purpose.",
        },
        type: {
          type: "string",
          enum: ["global", "personal"],
          description: "Space type. 'global' (default) = shared team space. 'personal' = private user space.",
        },
      },
      required: ["key", "name"],
    },
  },
  {
    name: "confluence_delete_space",
    description:
      "DESTRUCTIVE: Permanently delete a Confluence space and ALL its pages, attachments, and comments. " +
      "This cannot be undone. Use confluence_get_space first to verify you have the right space.",
    inputSchema: {
      type: "object",
      properties: {
        space_id: {
          type: "string",
          description: "Numeric space ID to delete. Use confluence_list_spaces to find the ID.",
        },
      },
      required: ["space_id"],
    },
  },

  // ==================== Confluence Page Tools ====================
  {
    name: "confluence_list_pages",
    description:
      "List Confluence pages with optional filters. " +
      "IMPORTANT: Without a space_id filter, this returns pages across ALL spaces — always pass space_id when you know which space to look in. " +
      "Returns page id, title, status, spaceId, parentId. Does NOT return page body by default — pass body_format to include it. " +
      "Pagination: if the response includes a 'cursor' field, pass it back to get the next page.",
    inputSchema: {
      type: "object",
      properties: {
        space_id: {
          type: "string",
          description: "Filter by space ID. Strongly recommended to avoid scanning all spaces.",
        },
        status: {
          type: "string",
          enum: ["current", "draft", "trashed"],
          description: "Filter by page status. 'current' = published pages (most common).",
        },
        title: {
          type: "string",
          description: "Filter by exact page title (case-sensitive exact match). For partial/fuzzy search, use confluence_search instead.",
        },
        body_format: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description:
            "Include page body in this format. 'storage' = raw XHTML markup (best for reading/editing). " +
            "'view' = rendered HTML (best for display). Omit to skip body content and only get metadata.",
        },
        limit: {
          type: "number",
          description: "Max results per page (default: 25, max: 250).",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from previous response 'cursor' field. Omit for first page.",
        },
      },
    },
  },
  {
    name: "confluence_get_page",
    description:
      "Get a single Confluence page by its numeric ID. " +
      "IMPORTANT: The page body is NOT returned unless you pass body_format. Use body_format='storage' to get the editable XHTML content. " +
      "Returns: id, title, status, spaceId, parentId, version (number, message), body (if requested).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID (e.g., '98306'). Use confluence_list_pages or confluence_search to find page IDs.",
        },
        body_format: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description:
            "Format for the body content. 'storage' = raw XHTML (for editing — pass this to confluence_update_page). " +
            "'view' = rendered HTML. Omit to skip body and only get metadata.",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "confluence_create_page",
    description:
      "Create a new Confluence page. The body uses Confluence storage format — an XHTML-like markup. " +
      "Common tags: <p>paragraph</p>, <h1>heading</h1>, <ul><li>bullet</li></ul>, <a href=\"url\">link</a>, " +
      "<ac:structured-macro> for macros. Plain text without tags will NOT render properly — always wrap in <p> tags at minimum.",
    inputSchema: {
      type: "object",
      properties: {
        space_id: {
          type: "string",
          description: "Space ID to create the page in. Use confluence_list_spaces to find the ID.",
        },
        title: {
          type: "string",
          description: "Page title. Must be unique within the space.",
        },
        body: {
          type: "string",
          description:
            "Page body in storage format (XHTML). Examples: " +
            "'<p>Simple paragraph</p>', " +
            "'<h1>Title</h1><p>Body text</p>', " +
            "'<ul><li>Item 1</li><li>Item 2</li></ul>'. " +
            "Omit to create a blank page.",
        },
        parent_id: {
          type: "string",
          description: "Parent page ID to nest this page under. Omit to create a top-level page in the space.",
        },
        status: {
          type: "string",
          enum: ["current", "draft"],
          description: "Page status. 'current' (default) = published and visible. 'draft' = not yet published.",
        },
      },
      required: ["space_id", "title"],
    },
  },
  {
    name: "confluence_update_page",
    description:
      "Update an existing Confluence page. You must provide at least a new title or new body (or both). " +
      "Version number is handled automatically — you do not need to track or pass it. " +
      "WARNING: The body parameter REPLACES the entire page body. To edit part of a page, first read it with " +
      "confluence_get_page(body_format='storage'), modify the returned XHTML, then pass the full modified body here.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID to update.",
        },
        title: {
          type: "string",
          description: "New page title. Omit to keep the current title.",
        },
        body: {
          type: "string",
          description:
            "New FULL page body in storage format (XHTML). This REPLACES the entire page content. " +
            "To make a small edit: (1) read the page with body_format='storage', (2) modify the XHTML, (3) pass the full result here.",
        },
        status: {
          type: "string",
          enum: ["current", "draft"],
          description: "Change page status. 'current' = published, 'draft' = unpublished.",
        },
        version_message: {
          type: "string",
          description: "Version comment shown in the page's history/changelog (e.g., 'Updated pricing section').",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "confluence_delete_page",
    description:
      "DESTRUCTIVE: Delete a Confluence page. The page is moved to trash and can be recovered by a Confluence admin. " +
      "All child pages are also affected. Use confluence_get_page first to verify you have the right page.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID to delete. Use confluence_list_pages or confluence_search to find the ID.",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "confluence_get_child_pages",
    description:
      "Get the immediate child pages of a given Confluence page (one level deep, not recursive). " +
      "Returns page metadata without body content. " +
      "Pagination: if the response includes a 'cursor' field, pass it back to get the next page.",
    inputSchema: {
      type: "object",
      properties: {
        parent_id: {
          type: "string",
          description: "Numeric page ID of the parent page whose children you want to list.",
        },
        limit: {
          type: "number",
          description: "Max results per page (default: 25).",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from previous response 'cursor' field. Omit for first page.",
        },
      },
      required: ["parent_id"],
    },
  },
  {
    name: "confluence_get_page_ancestors",
    description:
      "Get the ancestor chain (all parent pages) of a Confluence page. " +
      "Returns an array ordered from the root/top-level page down to the immediate parent. " +
      "Useful for understanding where a page sits in the page tree hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID whose ancestors (parent chain) you want to retrieve.",
        },
      },
      required: ["page_id"],
    },
  },

  // ==================== Confluence Search Tools ====================
  {
    name: "confluence_search",
    description:
      "Search Confluence using CQL (Confluence Query Language). This is the best way to find pages by content, title, or labels. " +
      "Unlike confluence_list_pages (exact title match only), this supports full-text search and complex filters. " +
      "Returns: title, excerpt, content ID/type, space info, last modified date. " +
      "Note: uses offset-based pagination (start + limit), not cursor-based.",
    inputSchema: {
      type: "object",
      properties: {
        cql: {
          type: "string",
          description:
            "CQL query string. Common patterns: " +
            "'type=page AND space=ENG' (pages in a space by KEY), " +
            "'type=page AND text~\"deploy\"' (full-text search), " +
            "'type=page AND title~\"Release\"' (title contains), " +
            "'type=page AND label=\"important\"' (pages with label), " +
            "'type=page AND creator=currentUser()' (my pages), " +
            "'type=page AND lastModified > now(\"-7d\")' (changed this week). " +
            "Combine with AND/OR. Use ~ for contains, = for exact match.",
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 25, max: 200).",
        },
        start: {
          type: "number",
          description: "Result offset for pagination. First page = 0. Next page = start + limit.",
        },
      },
      required: ["cql"],
    },
  },

  // ==================== Confluence Comment Tools ====================
  {
    name: "confluence_get_page_comments",
    description:
      "Get footer comments on a Confluence page. Footer comments appear at the bottom of the page (not inline). " +
      "Returns comment id, body, version. " +
      "Pagination: if the response includes a 'cursor' field, pass it back to get the next page.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID to get comments from.",
        },
        body_format: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "Format for comment body. 'storage' = raw XHTML, 'view' = rendered HTML. Defaults to storage.",
        },
        limit: {
          type: "number",
          description: "Max comments to return per page (default: 25).",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from previous response 'cursor' field. Omit for first page.",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "confluence_get_comment",
    description:
      "Get a single Confluence comment by its numeric ID. Returns comment body, version, and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        comment_id: {
          type: "string",
          description: "Numeric comment ID. Found in the results of confluence_get_page_comments.",
        },
        body_format: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "Format for comment body. 'storage' = raw XHTML (default), 'view' = rendered HTML.",
        },
      },
      required: ["comment_id"],
    },
  },
  {
    name: "confluence_create_comment",
    description:
      "Add a footer comment to a Confluence page. The body uses storage format (XHTML), same as page bodies. " +
      "Always wrap text in HTML tags: '<p>My comment</p>'.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID to add the comment to.",
        },
        body: {
          type: "string",
          description: "Comment body in storage format (XHTML). Example: '<p>Looks good, approved!</p>'.",
        },
      },
      required: ["page_id", "body"],
    },
  },
  {
    name: "confluence_update_comment",
    description:
      "Update an existing Confluence comment. Version number is handled automatically. " +
      "The body REPLACES the entire comment content.",
    inputSchema: {
      type: "object",
      properties: {
        comment_id: {
          type: "string",
          description: "Numeric comment ID to update.",
        },
        body: {
          type: "string",
          description: "New FULL comment body in storage format (XHTML). Replaces the entire comment.",
        },
      },
      required: ["comment_id", "body"],
    },
  },
  {
    name: "confluence_delete_comment",
    description:
      "DESTRUCTIVE: Delete a Confluence comment. This cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        comment_id: {
          type: "string",
          description: "Numeric comment ID to delete.",
        },
      },
      required: ["comment_id"],
    },
  },

  // ==================== Confluence Label Tools ====================
  {
    name: "confluence_get_page_labels",
    description:
      "Get all labels on a Confluence page. Labels are simple string tags used for categorization and search filtering. " +
      "Returns label id, name, and prefix ('global' for user-created labels). " +
      "Pagination: if the response includes a 'cursor' field, pass it back to get the next page.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID.",
        },
        limit: {
          type: "number",
          description: "Max labels to return per page (default: 25).",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from previous response 'cursor' field. Omit for first page.",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "confluence_add_page_labels",
    description:
      "Add one or more labels to a Confluence page. Labels are lowercase string tags. " +
      "If a label already exists on the page, it is silently ignored (idempotent). " +
      "Labels can then be used in CQL search: label=\"my-label\".",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of label names to add. Use lowercase, no spaces (use hyphens). " +
            "Example: [\"reviewed\", \"q1-2025\", \"architecture\"].",
        },
      },
      required: ["page_id", "labels"],
    },
  },
  {
    name: "confluence_remove_page_label",
    description:
      "Remove a single label from a Confluence page. If the label does not exist on the page, this may return an error.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID.",
        },
        label: {
          type: "string",
          description: "Exact label name to remove (e.g., 'outdated').",
        },
      },
      required: ["page_id", "label"],
    },
  },

  // ==================== Confluence Attachment Tools ====================
  {
    name: "confluence_get_page_attachments",
    description:
      "List all file attachments on a Confluence page. Returns attachment id, title (filename), mediaType, fileSize. " +
      "Pagination: if the response includes a 'cursor' field, pass it back to get the next page.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID.",
        },
        limit: {
          type: "number",
          description: "Max results per page (default: 25).",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from previous response 'cursor' field. Omit for first page.",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "confluence_get_attachment",
    description:
      "Get metadata about a single Confluence attachment by its numeric ID. " +
      "Returns: id, title (filename), mediaType, fileSize, version, pageId. " +
      "Does NOT return the file content — only metadata.",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description: "Numeric attachment ID. Found in the results of confluence_get_page_attachments.",
        },
      },
      required: ["attachment_id"],
    },
  },
  {
    name: "confluence_upload_attachment",
    description:
      "Upload a file to a Confluence page as an attachment. The file content must be base64-encoded. " +
      "If a file with the same name already exists, Confluence creates a new version of that attachment. " +
      "Max file size depends on your Confluence instance settings (typically 200MB).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID to attach the file to.",
        },
        filename: {
          type: "string",
          description: "Filename including extension (e.g., 'architecture-diagram.png', 'report.pdf').",
        },
        content: {
          type: "string",
          description: "File content encoded as a base64 string.",
        },
        comment: {
          type: "string",
          description: "Optional version comment for the attachment (e.g., 'Updated diagram with new service').",
        },
      },
      required: ["page_id", "filename", "content"],
    },
  },
  {
    name: "confluence_delete_attachment",
    description:
      "DESTRUCTIVE: Delete a Confluence attachment. This permanently removes the file. " +
      "Use confluence_get_attachment first to verify you have the right file.",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description: "Numeric attachment ID to delete. Use confluence_get_page_attachments to find the ID.",
        },
      },
      required: ["attachment_id"],
    },
  },

  // ==================== Confluence Content Property Tools ====================
  {
    name: "confluence_get_page_properties",
    description:
      "Get all content properties on a Confluence page. Properties are key-value metadata pairs stored on pages " +
      "(separate from labels). Commonly used by apps/integrations to store structured data. " +
      "Returns an array of {id, key, value, version} objects.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID.",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "confluence_get_page_property",
    description:
      "Get a single content property by its key from a Confluence page. " +
      "Returns {id, key, value, version}. The value can be any JSON type (string, number, object, array).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID.",
        },
        property_key: {
          type: "string",
          description: "Exact property key name (e.g., 'my-app.config', 'status').",
        },
      },
      required: ["page_id", "property_key"],
    },
  },
  {
    name: "confluence_set_page_property",
    description:
      "Create or update a content property on a Confluence page. " +
      "If the key already exists, the value is updated and the version is auto-incremented. " +
      "If the key does not exist, a new property is created. This operation is idempotent.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Numeric page ID.",
        },
        key: {
          type: "string",
          description: "Property key name. Use namespaced keys to avoid collisions (e.g., 'myapp.status').",
        },
        value: {
          type: ["string", "number", "boolean", "object", "array"],
          description:
            "Property value. Can be any JSON-serializable type: " +
            "string ('active'), number (42), boolean (true), object ({\"status\": \"done\"}), or array ([1, 2, 3]).",
        },
      },
      required: ["page_id", "key", "value"],
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
  const epic = await getJiraClient().getIssue(epicKey);

  if (epic.issueType !== "Epic") {
    throw new Error(`${epicKey} is not an Epic (found: ${epic.issueType})`);
  }

  // Fetch all child tasks
  const searchResult = await getJiraClient().searchIssues(
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
  const jiraUrl = process.env.JIRA_URL || "https://your-domain.atlassian.net";
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
        return await getJiraClient().getIssue(args.issue_key as string);

      case "jira_create_issue":
        return await getJiraClient().createIssue({
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
        return await getJiraClient().updateIssue(args.issue_key as string, {
          summary: args.summary as string | undefined,
          description: args.description as string | undefined,
          priority: args.priority as string | undefined,
          assigneeId: args.assignee_id as string | undefined,
          labels: args.labels as string[] | undefined,
          storyPoints: args.story_points as number | undefined,
          parentKey: args.parent_key as string | undefined,
        });

      case "jira_delete_issue":
        await getJiraClient().deleteIssue(args.issue_key as string);
        return { success: true, message: `Issue ${args.issue_key} deleted` };

      case "jira_search_issues":
        return await getJiraClient().searchIssues(
          args.jql as string,
          args.max_results as number | undefined
        );

      case "jira_add_comment":
        return await getJiraClient().addComment(
          args.issue_key as string,
          args.comment as string
        );

      case "jira_get_comments":
        return await getJiraClient().getComments(
          args.issue_key as string,
          args.max_results as number | undefined,
          args.start_at as number | undefined
        );

      case "jira_get_comment":
        return await getJiraClient().getComment(
          args.issue_key as string,
          args.comment_id as string
        );

      case "jira_update_comment":
        return await getJiraClient().updateComment(
          args.issue_key as string,
          args.comment_id as string,
          args.comment as string
        );

      case "jira_delete_comment":
        await getJiraClient().deleteComment(
          args.issue_key as string,
          args.comment_id as string
        );
        return { success: true, message: `Comment ${args.comment_id} deleted` };

      case "jira_transition_issue": {
        const transitions = await getJiraClient().getTransitions(args.issue_key as string);
        const targetTransition = transitions.find(
          (t) => t.name.toLowerCase() === (args.transition_name as string).toLowerCase()
        );
        if (!targetTransition) {
          const available = transitions.map((t) => t.name).join(", ");
          throw new Error(`Transition '${args.transition_name}' not available. Available: ${available}`);
        }
        await getJiraClient().transitionIssue(args.issue_key as string, targetTransition.id);
        return { success: true, message: `Issue transitioned to '${args.transition_name}'` };
      }

      // Project tools
      case "jira_list_projects":
        return await getJiraClient().listProjects();

      case "jira_get_project":
        return await getJiraClient().getProject(args.project_key as string);

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

        return await getJiraClient().createProject({
          key: args.key as string,
          name: args.name as string,
          description: args.description as string | undefined,
          leadAccountId: args.lead_account_id as string | undefined,
          projectTypeKey: args.project_type ? typeMap[args.project_type as string] : undefined,
          projectTemplateKey: args.template ? templateMap[args.template as string] : undefined,
        });
      }

      case "jira_validate_project_key":
        return await getJiraClient().validateProjectKey(args.key as string);

      case "jira_delete_project":
        return await getJiraClient().deleteProject(args.project_key as string);

      // Sprint tools
      case "jira_list_sprints":
        return await getJiraClient().listSprintsForBoard(
          args.board_id as number,
          args.state as SprintState | undefined
        );

      case "jira_get_sprint":
        return await getJiraClient().getSprint(args.sprint_id as number);

      case "jira_create_sprint":
        return await getJiraClient().createSprint({
          boardId: args.board_id as number,
          name: args.name as string,
          startDate: args.start_date as string | undefined,
          endDate: args.end_date as string | undefined,
          goal: args.goal as string | undefined,
        });

      case "jira_update_sprint":
        return await getJiraClient().updateSprint(args.sprint_id as number, {
          name: args.name as string | undefined,
          startDate: args.start_date as string | undefined,
          endDate: args.end_date as string | undefined,
          goal: args.goal as string | undefined,
        });

      case "jira_start_sprint":
        return await getJiraClient().startSprint(
          args.sprint_id as number,
          args.start_date as string,
          args.end_date as string
        );

      case "jira_complete_sprint":
        return await getJiraClient().completeSprint(args.sprint_id as number);

      case "jira_delete_sprint":
        await getJiraClient().deleteSprint(args.sprint_id as number);
        return { success: true, message: `Sprint ${args.sprint_id} deleted` };

      case "jira_get_sprint_issues":
        return await getJiraClient().getSprintIssues(args.sprint_id as number);

      case "jira_move_issues_to_sprint":
        await getJiraClient().moveIssuesToSprint(
          args.sprint_id as number,
          args.issue_keys as string[]
        );
        return {
          success: true,
          message: `Moved ${(args.issue_keys as string[]).length} issues to sprint ${args.sprint_id}`,
        };

      // Sprint Analytics tools
      case "jira_get_sprint_report":
        return await getJiraClient().getSprintReport(args.sprint_id as number);

      case "jira_get_sprint_velocity":
        return await getJiraClient().getSprintVelocity(args.sprint_id as number);

      case "jira_get_velocity_report":
        return await getJiraClient().getVelocityReport(
          args.board_id as number,
          args.sprint_count as number | undefined
        );

      case "jira_get_sprint_burndown":
        return await getJiraClient().getSprintBurndown(args.sprint_id as number);

      // Board tools
      case "jira_list_boards":
        return await getJiraClient().listBoards(args.project_key as string | undefined);

      case "jira_get_board":
        return await getJiraClient().getBoard(args.board_id as number);

      // User tools
      case "jira_get_current_user":
        return await getJiraClient().getCurrentUser();

      case "jira_search_users":
        return await getJiraClient().searchUsers(args.query as string);

      // Field Configuration tools
      case "jira_get_create_meta":
        return await getJiraClient().getCreateMeta(
          args.project_key as string,
          args.issue_type as string | undefined
        );

      case "jira_list_field_configurations":
        return await getJiraClient().getFieldConfigurations();

      case "jira_get_field_configuration":
        return await getJiraClient().getFieldConfiguration(args.config_id as string);

      case "jira_get_field_configuration_items":
        return await getJiraClient().getFieldConfigurationItems(args.config_id as string);

      case "jira_update_field_configuration_item": {
        const updates: Partial<{ isRequired: boolean; isHidden: boolean; description: string }> = {};
        if (args.is_required !== undefined) updates.isRequired = args.is_required as boolean;
        if (args.is_hidden !== undefined) updates.isHidden = args.is_hidden as boolean;
        if (args.description !== undefined) updates.description = args.description as string;

        await getJiraClient().updateFieldConfigurationItem(
          args.config_id as string,
          args.field_id as string,
          updates
        );
        return {
          success: true,
          message: `Field ${args.field_id} updated in configuration ${args.config_id}`,
        };
      }

      // Custom Field tools
      case "jira_list_fields":
        return await getJiraClient().listFields();

      case "jira_list_custom_fields":
        return await getJiraClient().listCustomFields();

      case "jira_get_field":
        return await getJiraClient().getField(args.field_id as string);

      case "jira_get_field_options":
        return await getJiraClient().getFieldOptions(
          args.field_id as string,
          args.context_id as string | undefined
        );

      case "jira_get_issue_field_value":
        return await getJiraClient().getIssueFieldValue(
          args.issue_key as string,
          args.field_id as string
        );

      case "jira_set_issue_field_value":
        return await getJiraClient().setIssueFieldValue(
          args.issue_key as string,
          args.field_id as string,
          args.value
        );

      case "jira_get_issue_custom_fields":
        return await getJiraClient().getIssueCustomFields(
          args.issue_key as string,
          args.field_ids as string[] | undefined
        );

      // Time Tracking tools
      case "jira_get_worklogs":
        return await getJiraClient().getWorklogs(args.issue_key as string);

      case "jira_add_worklog":
        return await getJiraClient().addWorklog(args.issue_key as string, {
          timeSpent: args.time_spent as string | undefined,
          timeSpentSeconds: args.time_spent_seconds as number | undefined,
          started: args.started as string | undefined,
          comment: args.comment as string | undefined,
        });

      case "jira_update_worklog":
        return await getJiraClient().updateWorklog(
          args.issue_key as string,
          args.worklog_id as string,
          {
            timeSpent: args.time_spent as string | undefined,
            timeSpentSeconds: args.time_spent_seconds as number | undefined,
            started: args.started as string | undefined,
            comment: args.comment as string | undefined,
          }
        );

      case "jira_delete_worklog":
        await getJiraClient().deleteWorklog(
          args.issue_key as string,
          args.worklog_id as string
        );
        return { success: true, message: `Worklog ${args.worklog_id} deleted` };

      case "jira_get_time_tracking":
        return await getJiraClient().getTimeTracking(args.issue_key as string);

      case "jira_set_time_tracking":
        return await getJiraClient().setTimeTracking(
          args.issue_key as string,
          args.original_estimate as string | undefined,
          args.remaining_estimate as string | undefined
        );

      // Attachment tools
      case "jira_get_attachments":
        return await getJiraClient().getAttachments(args.issue_key as string);

      case "jira_add_attachment":
        return await getJiraClient().addAttachment(
          args.issue_key as string,
          args.filename as string,
          args.content_base64 as string
        );

      case "jira_delete_attachment":
        await getJiraClient().deleteAttachment(args.attachment_id as string);
        return { success: true, message: `Attachment ${args.attachment_id} deleted` };

      case "jira_get_attachment":
        return await getJiraClient().getAttachment(args.attachment_id as string);

      // Webhook tools
      case "jira_list_webhooks":
        return await getJiraClient().listWebhooks();

      case "jira_get_webhook":
        return await getJiraClient().getWebhook(args.webhook_id as number);

      case "jira_create_webhook":
        return await getJiraClient().createWebhook({
          name: args.name as string,
          url: args.url as string,
          events: args.events as string[],
          filters: args.jql_filter
            ? { issueRelatedEventsSection: args.jql_filter as string }
            : undefined,
        });

      case "jira_delete_webhooks":
        await getJiraClient().deleteWebhooks(args.webhook_ids as number[]);
        return { success: true, message: `Deleted ${(args.webhook_ids as number[]).length} webhook(s)` };

      case "jira_refresh_webhooks":
        return await getJiraClient().refreshWebhooks(args.webhook_ids as number[]);

      case "jira_get_failed_webhooks":
        return await getJiraClient().getFailedWebhooks(args.after as number | undefined);

      // Issue Link tools
      case "jira_list_issue_link_types":
        return await getJiraClient().listIssueLinkTypes();

      case "jira_get_issue_links":
        return await getJiraClient().getIssueLinks(args.issue_key as string);

      case "jira_create_issue_link":
        return await getJiraClient().createIssueLink({
          type: args.type as string,
          inwardIssue: args.inward_issue as string,
          outwardIssue: args.outward_issue as string,
          comment: args.comment as string | undefined,
        });

      case "jira_delete_issue_link":
        await getJiraClient().deleteIssueLink(args.link_id as string);
        return { success: true, message: `Issue link ${args.link_id} deleted` };

      // JQL Filter tools
      case "jira_list_filters":
        return await getJiraClient().listFilters(args.expand as string | undefined);

      case "jira_get_filter":
        return await getJiraClient().getFilter(
          args.filter_id as string,
          args.expand as string | undefined
        );

      case "jira_search_filters":
        return await getJiraClient().searchFilters(
          args.filter_name as string,
          args.expand as string | undefined
        );

      case "jira_create_filter":
        return await getJiraClient().createFilter({
          name: args.name as string,
          jql: args.jql as string,
          description: args.description as string | undefined,
          favourite: args.favourite as boolean | undefined,
        });

      case "jira_update_filter":
        return await getJiraClient().updateFilter(args.filter_id as string, {
          name: args.name as string | undefined,
          jql: args.jql as string | undefined,
          description: args.description as string | undefined,
          favourite: args.favourite as boolean | undefined,
        });

      case "jira_delete_filter":
        await getJiraClient().deleteFilter(args.filter_id as string);
        return { success: true, message: `Filter ${args.filter_id} deleted` };

      case "jira_set_filter_favourite":
        return await getJiraClient().setFilterFavourite(
          args.filter_id as string,
          args.favourite as boolean
        );

      case "jira_get_favourite_filters":
        return await getJiraClient().getFavouriteFilters(args.expand as string | undefined);

      case "jira_execute_filter":
        return await getJiraClient().executeFilter(
          args.filter_id as string,
          args.max_results as number | undefined
        );

      // Bulk operations tools
      case "jira_bulk_transition_issues":
        return await getJiraClient().bulkTransitionIssues(
          args.issue_keys as string[],
          args.transition_name as string
        );

      case "jira_bulk_update_issues":
        return await getJiraClient().bulkUpdateIssues(
          args.issue_keys as string[],
          {
            summary: args.summary as string | undefined,
            priority: args.priority as string | undefined,
            assigneeId: args.assignee_id as string | undefined,
            labels: args.labels as string[] | undefined,
          }
        );

      case "jira_bulk_delete_issues":
        return await getJiraClient().bulkDeleteIssues(args.issue_keys as string[]);

      case "jira_bulk_move_to_sprint":
        return await getJiraClient().bulkMoveToSprintWithVerification(
          args.sprint_id as number,
          args.issue_keys as string[]
        );

      case "jira_bulk_add_labels":
        return await getJiraClient().bulkAddLabels(
          args.issue_keys as string[],
          args.labels as string[]
        );

      case "jira_bulk_assign_issues":
        return await getJiraClient().bulkAssignIssues(
          args.issue_keys as string[],
          (args.assignee_id as string) || null
        );

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

      // Account Management tools
      case "jira_list_accounts":
        return {
          accounts: accountManager.listAccounts(),
          activeAccountId: accountManager.getActiveAccount()?.id || null,
          totalAccounts: accountManager.getAccountCount(),
        };

      case "jira_add_account": {
        const newAccount = accountManager.addAccount({
          id: args.id as string,
          name: args.name as string,
          url: args.url as string,
          email: args.email as string,
          apiKey: args.api_key as string,
        });
        return {
          success: true,
          message: `Account '${newAccount.id}' added successfully`,
          account: newAccount,
        };
      }

      case "jira_remove_account": {
        const removed = accountManager.removeAccount(args.id as string);
        return {
          success: removed,
          message: removed
            ? `Account '${args.id}' removed successfully`
            : `Account '${args.id}' not found`,
        };
      }

      case "jira_switch_account": {
        const switchedAccount = accountManager.setActiveAccount(args.id as string);
        return {
          success: true,
          message: `Switched to account '${switchedAccount.id}'`,
          account: switchedAccount,
        };
      }

      case "jira_test_account": {
        const accountId = (args.id as string) || accountManager.getActiveAccount()?.id;
        if (!accountId) {
          return { success: false, error: "No account specified and no active account" };
        }
        return await accountManager.testConnection(accountId);
      }

      // ==================== Confluence Space Tools ====================
      case "confluence_list_spaces":
        return await getConfluenceClient().listSpaces({
          type: args.type as string | undefined,
          status: args.status as string | undefined,
          limit: args.limit as number | undefined,
          cursor: args.cursor as string | undefined,
        });

      case "confluence_get_space":
        return await getConfluenceClient().getSpace(args.space_id as string);

      case "confluence_create_space":
        return await getConfluenceClient().createSpace({
          key: args.key as string,
          name: args.name as string,
          description: args.description as string | undefined,
          type: args.type as "global" | "personal" | undefined,
        });

      case "confluence_delete_space":
        await getConfluenceClient().deleteSpace(args.space_id as string);
        return { success: true, message: `Space ${args.space_id} deleted` };

      // ==================== Confluence Page Tools ====================
      case "confluence_list_pages":
        return await getConfluenceClient().listPages({
          spaceId: args.space_id as string | undefined,
          status: args.status as ConfluencePageStatus | undefined,
          title: args.title as string | undefined,
          bodyFormat: args.body_format as ConfluenceBodyFormat | undefined,
          limit: args.limit as number | undefined,
          cursor: args.cursor as string | undefined,
        });

      case "confluence_get_page":
        return await getConfluenceClient().getPage(
          args.page_id as string,
          args.body_format as ConfluenceBodyFormat | undefined,
        );

      case "confluence_create_page":
        return await getConfluenceClient().createPage({
          spaceId: args.space_id as string,
          title: args.title as string,
          body: args.body as string | undefined,
          parentId: args.parent_id as string | undefined,
          status: args.status as ConfluencePageStatus | undefined,
        });

      case "confluence_update_page":
        return await getConfluenceClient().updatePage(args.page_id as string, {
          title: args.title as string | undefined,
          body: args.body as string | undefined,
          status: args.status as ConfluencePageStatus | undefined,
          versionMessage: args.version_message as string | undefined,
        });

      case "confluence_delete_page":
        await getConfluenceClient().deletePage(args.page_id as string);
        return { success: true, message: `Page ${args.page_id} deleted` };

      case "confluence_get_child_pages":
        return await getConfluenceClient().getChildPages(
          args.parent_id as string,
          {
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        );

      case "confluence_get_page_ancestors":
        return await getConfluenceClient().getPageAncestors(args.page_id as string);

      // ==================== Confluence Search Tools ====================
      case "confluence_search":
        return await getConfluenceClient().search(
          args.cql as string,
          {
            limit: args.limit as number | undefined,
            start: args.start as number | undefined,
          },
        );

      // ==================== Confluence Comment Tools ====================
      case "confluence_get_page_comments":
        return await getConfluenceClient().getPageComments(
          args.page_id as string,
          {
            bodyFormat: args.body_format as ConfluenceBodyFormat | undefined,
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        );

      case "confluence_get_comment":
        return await getConfluenceClient().getComment(
          args.comment_id as string,
          args.body_format as ConfluenceBodyFormat | undefined,
        );

      case "confluence_create_comment":
        return await getConfluenceClient().createComment(
          args.page_id as string,
          { body: args.body as string },
        );

      case "confluence_update_comment":
        return await getConfluenceClient().updateComment(
          args.comment_id as string,
          { body: args.body as string },
        );

      case "confluence_delete_comment":
        await getConfluenceClient().deleteComment(args.comment_id as string);
        return { success: true, message: `Comment ${args.comment_id} deleted` };

      // ==================== Confluence Label Tools ====================
      case "confluence_get_page_labels":
        return await getConfluenceClient().getPageLabels(
          args.page_id as string,
          {
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        );

      case "confluence_add_page_labels": {
        const labels = Array.isArray(args.labels)
          ? args.labels as string[]
          : JSON.parse(args.labels as string) as string[];
        return await getConfluenceClient().addPageLabels(
          args.page_id as string,
          labels,
        );
      }

      case "confluence_remove_page_label":
        await getConfluenceClient().removePageLabel(
          args.page_id as string,
          args.label as string,
        );
        return { success: true, message: `Label '${args.label}' removed from page ${args.page_id}` };

      // ==================== Confluence Attachment Tools ====================
      case "confluence_get_page_attachments":
        return await getConfluenceClient().getPageAttachments(
          args.page_id as string,
          {
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        );

      case "confluence_get_attachment":
        return await getConfluenceClient().getAttachment(args.attachment_id as string);

      case "confluence_upload_attachment":
        return await getConfluenceClient().uploadAttachment(
          args.page_id as string,
          args.filename as string,
          args.content as string,
          args.comment as string | undefined,
        );

      case "confluence_delete_attachment":
        await getConfluenceClient().deleteAttachment(args.attachment_id as string);
        return { success: true, message: `Attachment ${args.attachment_id} deleted` };

      // ==================== Confluence Content Property Tools ====================
      case "confluence_get_page_properties":
        return await getConfluenceClient().getPageProperties(args.page_id as string);

      case "confluence_get_page_property":
        return await getConfluenceClient().getPageProperty(
          args.page_id as string,
          args.property_key as string,
        );

      case "confluence_set_page_property":
        return await getConfluenceClient().setPageProperty(
          args.page_id as string,
          args.key as string,
          args.value,
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof JiraClientError || error instanceof ConfluenceClientError) {
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
