# @bodywave/jira-mcp

MCP (Model Context Protocol) server for Jira with full sprint management, bulk operations, and multi-account support.

## Installation

### With Claude Code

```bash
claude mcp add bodywave-jira --scope user -- env JIRA_URL=https://your-domain.atlassian.net JIRA_EMAIL=your@email.com JIRA_API_KEY=your-api-key npx -y @bodywave/jira-mcp
```

### Manual Configuration

Add to your `~/.claude.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "bodywave-jira": {
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

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JIRA_URL` | Your Jira instance URL | `https://bodywave.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email | `you@example.com` |
| `JIRA_API_KEY` | Jira API token ([Generate here](https://id.atlassian.com/manage-profile/security/api-tokens)) | `ATATT3xFfGF0...` |

## Available Tools

### Issue Management

| Tool | Description |
|------|-------------|
| `jira_get_issue` | Get issue details |
| `jira_create_issue` | Create a new issue |
| `jira_update_issue` | Update an existing issue |
| `jira_delete_issue` | Delete an issue |
| `jira_search_issues` | Search with JQL |
| `jira_add_comment` | Add a comment to an issue |
| `jira_transition_issue` | Change issue status |

### Sprint Management

| Tool | Description |
|------|-------------|
| `jira_list_sprints` | List sprints for a board |
| `jira_get_sprint` | Get sprint details |
| `jira_create_sprint` | Create a new sprint |
| `jira_update_sprint` | Update sprint details |
| `jira_start_sprint` | Start a sprint |
| `jira_complete_sprint` | Complete/close a sprint |
| `jira_delete_sprint` | Delete a sprint |
| `jira_get_sprint_issues` | Get issues in a sprint |
| `jira_move_issues_to_sprint` | Move issues to a sprint |

### Board & Project Management

| Tool | Description |
|------|-------------|
| `jira_list_projects` | List all accessible projects |
| `jira_get_project` | Get project details |
| `jira_list_boards` | List boards (optionally by project) |
| `jira_get_board` | Get board details |

### User Management

| Tool | Description |
|------|-------------|
| `jira_get_current_user` | Get authenticated user info |
| `jira_search_users` | Search for users |

## Usage Examples

### Create a sprint

```
Create a new sprint called "Sprint 5" for board 1 starting January 6th, ending January 17th
```

### Move issues to sprint

```
Move issues BCM-101, BCM-102, and BCM-103 to sprint 42
```

### Search with JQL

```
Search for all in-progress issues assigned to me: project = BCM AND status = "In Progress" AND assignee = currentUser()
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js

# Run tests
npm test
```

## License

MIT

## Author

Bodywave <engineering@bodywave.com>
