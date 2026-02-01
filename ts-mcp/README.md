# @bodywave/jira-mcp

A comprehensive MCP (Model Context Protocol) server for Jira Cloud. Gives AI agents like Claude full control over Jira — issues, sprints, boards, bulk operations, custom fields, time tracking, and more.

**89 tools** across 15 categories. Multi-account support built-in.

## Installation

### Claude Code (one-liner)

```bash
claude mcp add jira -- env \
  JIRA_URL=https://your-domain.atlassian.net \
  JIRA_EMAIL=your@email.com \
  JIRA_API_KEY=your-api-key \
  npx -y @bodywave/jira-mcp
```

### Manual Configuration

Add to your `~/.claude.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "@bodywave/jira-mcp"],
      "env": {
        "JIRA_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your@email.com",
        "JIRA_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Multiple Jira Accounts

Install the same package twice with different names and credentials:

```json
{
  "mcpServers": {
    "company-jira": {
      "command": "npx",
      "args": ["-y", "@bodywave/jira-mcp"],
      "env": {
        "JIRA_URL": "https://company.atlassian.net",
        "JIRA_EMAIL": "you@company.com",
        "JIRA_API_KEY": "token-1"
      }
    },
    "personal-jira": {
      "command": "npx",
      "args": ["-y", "@bodywave/jira-mcp"],
      "env": {
        "JIRA_URL": "https://personal.atlassian.net",
        "JIRA_EMAIL": "you@personal.com",
        "JIRA_API_KEY": "token-2"
      }
    }
  }
}
```

Or use the built-in account management tools (`jira_add_account`, `jira_switch_account`) at runtime.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `JIRA_URL` | Your Jira Cloud instance URL |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_KEY` | API token ([Generate here](https://id.atlassian.com/manage-profile/security/api-tokens)) |

## Tools (89)

### Issues (7)

| Tool | Description |
|------|-------------|
| `jira_get_issue` | Get issue details |
| `jira_create_issue` | Create a new issue |
| `jira_update_issue` | Update an existing issue |
| `jira_delete_issue` | Delete an issue |
| `jira_search_issues` | Search with JQL |
| `jira_add_comment` | Add a comment |
| `jira_transition_issue` | Change issue status |

### Comments (4)

| Tool | Description |
|------|-------------|
| `jira_get_comments` | Get all comments with pagination |
| `jira_get_comment` | Get a specific comment |
| `jira_update_comment` | Update a comment |
| `jira_delete_comment` | Delete a comment |

### Projects (5)

| Tool | Description |
|------|-------------|
| `jira_list_projects` | List all projects |
| `jira_get_project` | Get project details |
| `jira_create_project` | Create a project (Scrum/Kanban/Basic) |
| `jira_validate_project_key` | Check if a project key is available |
| `jira_delete_project` | Delete a project |

### Sprints (9)

| Tool | Description |
|------|-------------|
| `jira_list_sprints` | List sprints for a board |
| `jira_get_sprint` | Get sprint details |
| `jira_create_sprint` | Create a sprint |
| `jira_update_sprint` | Update a sprint |
| `jira_start_sprint` | Start a sprint |
| `jira_complete_sprint` | Complete/close a sprint |
| `jira_delete_sprint` | Delete a sprint |
| `jira_get_sprint_issues` | Get issues in a sprint |
| `jira_move_issues_to_sprint` | Move issues to a sprint |

### Sprint Analytics (4)

| Tool | Description |
|------|-------------|
| `jira_get_sprint_report` | Sprint report with completion rates |
| `jira_get_sprint_velocity` | Velocity data (committed vs completed) |
| `jira_get_velocity_report` | Velocity trends across sprints |
| `jira_get_sprint_burndown` | Burndown chart data |

### Boards & Users (4)

| Tool | Description |
|------|-------------|
| `jira_list_boards` | List boards (optionally by project) |
| `jira_get_board` | Get board details |
| `jira_get_current_user` | Get authenticated user info |
| `jira_search_users` | Search for users |

### Fields & Custom Fields (12)

| Tool | Description |
|------|-------------|
| `jira_get_create_meta` | Get field metadata for issue creation |
| `jira_list_field_configurations` | List field configurations |
| `jira_get_field_configuration` | Get field configuration details |
| `jira_get_field_configuration_items` | Get required/optional/hidden fields |
| `jira_update_field_configuration_item` | Update field visibility/requirement |
| `jira_list_fields` | List all fields (system + custom) |
| `jira_list_custom_fields` | List custom fields only |
| `jira_get_field` | Get field details |
| `jira_get_field_options` | Get select field options |
| `jira_get_issue_field_value` | Get a field value on an issue |
| `jira_set_issue_field_value` | Set a field value on an issue |
| `jira_get_issue_custom_fields` | Get all custom fields for an issue |

### Time Tracking (6)

| Tool | Description |
|------|-------------|
| `jira_get_worklogs` | Get time entries for an issue |
| `jira_add_worklog` | Log time on an issue |
| `jira_update_worklog` | Update a time entry |
| `jira_delete_worklog` | Delete a time entry |
| `jira_get_time_tracking` | Get estimates and logged time |
| `jira_set_time_tracking` | Set time estimates |

### Attachments (4)

| Tool | Description |
|------|-------------|
| `jira_get_attachments` | List attachments on an issue |
| `jira_add_attachment` | Add an attachment (base64 encoded) |
| `jira_delete_attachment` | Delete an attachment |
| `jira_get_attachment` | Get attachment metadata |

### Issue Links (4)

| Tool | Description |
|------|-------------|
| `jira_list_issue_link_types` | List link types (Blocks, Relates, etc.) |
| `jira_get_issue_links` | Get all links for an issue |
| `jira_create_issue_link` | Link two issues |
| `jira_delete_issue_link` | Remove an issue link |

### Filters (9)

| Tool | Description |
|------|-------------|
| `jira_list_filters` | List filters |
| `jira_get_filter` | Get filter details |
| `jira_search_filters` | Search filters by name |
| `jira_create_filter` | Create a JQL filter |
| `jira_update_filter` | Update a filter |
| `jira_delete_filter` | Delete a filter |
| `jira_set_filter_favourite` | Favourite/unfavourite a filter |
| `jira_get_favourite_filters` | Get favourite filters |
| `jira_execute_filter` | Run a saved filter |

### Webhooks (6)

| Tool | Description |
|------|-------------|
| `jira_list_webhooks` | List registered webhooks |
| `jira_get_webhook` | Get webhook details |
| `jira_create_webhook` | Register a webhook |
| `jira_delete_webhooks` | Delete webhooks |
| `jira_refresh_webhooks` | Extend webhook expiration |
| `jira_get_failed_webhooks` | Get failed webhook calls |

### Bulk Operations (6)

| Tool | Description |
|------|-------------|
| `jira_bulk_transition_issues` | Transition multiple issues with verification |
| `jira_bulk_update_issues` | Update multiple issues at once |
| `jira_bulk_delete_issues` | Delete multiple issues |
| `jira_bulk_move_to_sprint` | Move multiple issues to a sprint |
| `jira_bulk_add_labels` | Add labels to multiple issues |
| `jira_bulk_assign_issues` | Assign multiple issues to a user |

### Multi-Account Management (5)

| Tool | Description |
|------|-------------|
| `jira_list_accounts` | List configured accounts |
| `jira_add_account` | Add a Jira account |
| `jira_remove_account` | Remove an account |
| `jira_switch_account` | Switch active account |
| `jira_test_account` | Test account connection |

### Utilities (9)

| Tool | Description |
|------|-------------|
| `jira_mcp_version` | Get server version and changelog |
| `jira_get_metrics` | Get API request metrics and stats |
| `jira_suggest_project` | Generate project name/key from repo name |
| `jira_epic_workflow` | Generate Git workflow from an Epic |

## Usage Examples

```
# Natural language — just tell Claude what you need:

"Show me all in-progress issues assigned to me"

"Create a bug ticket in PROJ for the login timeout issue"

"Move PROJ-101 and PROJ-102 to the current sprint"

"What's our velocity trend for the last 5 sprints?"

"Transition all issues labeled 'ready' to In Review"

"Log 2 hours on PROJ-55 for code review"
```

## Development

```bash
npm install     # Install dependencies
npm run build   # Build TypeScript
npm test        # Run tests (111 tests)
```

## License

MIT
