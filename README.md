# Bodywave Jira MCP Server

A Python 3.13+ Master Control Program (MCP) server that enables AI agents to manage Jira Cloud spaces for Bodywave.

## Features

- **Full CRUD Operations**: Create, read, update, and delete Jira issues
- **Multi-Project Support**: Manage multiple Jira projects from a single interface
- **Agile/Scrum Management**: PI and Sprint tracking with automatic date calculations
- **AI Agent Integration**: MCP protocol support for seamless agent communication
- **Secure Authentication**: API Token with OAuth 2.0 migration path
- **Type-Safe**: Full type hints and dataclass models

## Quick Start

### Prerequisites

- Python 3.13+
- [uv](https://github.com/astral-sh/uv) (recommended) or pip
- Jira Cloud account with API token

### Installation

```bash
# Clone the repository
cd /Users/motty/code/bodywave/jira

# Install dependencies with uv
uv pip install -e .

# Or with pip
pip install -e .
```

### Configuration

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Edit `.env` with your credentials:
```bash
JIRA_BASE_URL=https://bodywave.atlassian.net
JIRA_USER_EMAIL=your-email@bodywave.com
JIRA_API_TOKEN=your-api-token
```

3. (Optional) Configure projects in `config/projects.json`

### Verify Installation

```bash
# Run verification script
python main.py --verify
```

## Usage

### As a Python Library

```python
from src.jira_client import JiraClient
from src.config import load_config

# Initialize client
config = load_config()
client = JiraClient(config)

# Create an issue
issue = client.create_issue(
    project_key="BCM",
    summary="Implement new feature",
    description="Detailed description here",
    issue_type="Task"
)
print(f"Created: {issue.key}")

# Search issues
issues = client.search_issues_jql("project = BCM AND status = 'In Progress'")
for issue in issues:
    print(f"{issue.key}: {issue.summary}")

# Update an issue
client.update_issue(issue.key, summary="Updated summary")

# Delete an issue
client.delete_issue(issue.key)
```

### As an MCP Server

```bash
# Start the MCP server
python -m src.mcp_orchestrator

# Or with custom configuration
python -m src.mcp_orchestrator --config config/production.json
```

### Sprint Management

```python
from src.agile_manager import AgileManager

agile = AgileManager(client)

# Get current PI information
current_pi = agile.get_current_pi()
print(f"Current PI: {current_pi.name}")

# Get sprints in current PI
sprints = agile.get_sprints_for_pi(current_pi)
for sprint in sprints:
    print(f"  {sprint.name}: {sprint.state}")

# Create a new sprint
new_sprint = agile.create_sprint(
    board_id=1,
    name="BCM-Sprint-PI2025Q1-4",
    start_date="2025-03-01",
    end_date="2025-03-14"
)
```

## Project Structure

```
bodywave-jira/
├── src/
│   ├── __init__.py          # Package initialization
│   ├── jira_client.py       # Jira REST API client
│   ├── mcp_orchestrator.py  # MCP server logic
│   ├── agile_manager.py     # PI/Sprint management
│   ├── models.py            # Data models
│   ├── config.py            # Configuration management
│   ├── auth.py              # Authentication providers
│   └── exceptions.py        # Custom exceptions
├── tests/
│   ├── __init__.py
│   ├── test_jira_client.py
│   ├── test_orchestrator.py
│   └── conftest.py          # Pytest fixtures
├── config/
│   └── projects.json        # Project definitions
├── main.py                  # Entry point
├── pyproject.toml           # Project configuration
├── .env.example             # Environment template
├── CLAUDE.md                # Engineering guidelines
└── README.md                # This file
```

## Agile Configuration

### Program Increments (PIs)

The system supports quarterly PIs with the following configuration:

| PI | Start Date | End Date | Sprints |
|----|------------|----------|---------|
| Q1 | Jan 1 | Mar 31 | 4-6 |
| Q2 | Apr 1 | Jun 30 | 4-6 |
| Q3 | Jul 1 | Sep 30 | 4-6 |
| Q4 | Oct 1 | Dec 31 | 4-6 |

### Sprint Configuration

Each project can have independent sprint cycles within the PI constraints:

```json
{
  "projects": [
    {
      "key": "BCM",
      "name": "BCM Cloud",
      "sprint_duration_weeks": 2,
      "sprints_per_pi": 6
    },
    {
      "key": "INFRA",
      "name": "Brainsway Infrastructure",
      "sprint_duration_weeks": 3,
      "sprints_per_pi": 4
    }
  ]
}
```

## API Reference

### JiraClient Methods

| Method | Description |
|--------|-------------|
| `create_issue(...)` | Create a new Jira issue |
| `get_issue(key)` | Get issue by key |
| `update_issue(key, ...)` | Update an existing issue |
| `delete_issue(key)` | Delete an issue |
| `search_issues_jql(jql)` | Search issues using JQL |
| `get_project(key)` | Get project details |
| `get_board(board_id)` | Get board details |
| `create_sprint(...)` | Create a new sprint |
| `close_sprint(sprint_id)` | Close a sprint |
| `add_issues_to_sprint(...)` | Add issues to a sprint |

### AgileManager Methods

| Method | Description |
|--------|-------------|
| `get_current_pi()` | Get current Program Increment |
| `get_current_sprint(project)` | Get current active sprint |
| `calculate_sprint_dates(...)` | Calculate sprint start/end dates |
| `get_sprints_for_pi(pi)` | Get all sprints in a PI |
| `get_pi_velocity(project, pi)` | Calculate velocity for PI |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_BASE_URL` | Yes | Jira Cloud URL (e.g., `https://bodywave.atlassian.net`) |
| `JIRA_USER_EMAIL` | Yes | Email for authentication |
| `JIRA_API_TOKEN` | Yes | API token from Atlassian account |
| `LOG_LEVEL` | No | Logging level (default: INFO) |
| `JIRA_TIMEOUT` | No | Request timeout in seconds (default: 30) |

## Authentication

### API Token (Current)

Generate an API token from your [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens).

### OAuth 2.0 (Future)

The codebase is designed to support OAuth 2.0 (3LO) migration:

```python
from src.auth import OAuth2Provider

# When ready to migrate:
auth_provider = OAuth2Provider(
    client_id="your-client-id",
    client_secret="your-client-secret",
    redirect_uri="http://localhost:8080/callback"
)
client = JiraClient(config, auth_provider=auth_provider)
```

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ --cov=src --cov-report=html

# Run specific test file
pytest tests/test_jira_client.py -v

# Run integration tests (requires real Jira access)
pytest tests/ -v --integration
```

## Contributing

See [CLAUDE.md](CLAUDE.md) for engineering guidelines and code standards.

## License

Proprietary - Bodywave Ltd.
