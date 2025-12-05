# Bodywave Jira MCP Server - Engineering Guidelines

## Project Overview

**bodywave-jira** is a Master Control Program (MCP) server that enables AI agents to fully manage multiple private Jira Cloud spaces for Bodywave. This codebase provides a Python-based interface for CRUD operations on Jira tickets, sprint management, and project configuration.

<!-- Test comment: Jira integration hook test - 2025-12-05 -->

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Agent Layer                          │
│              (Claude Code, other AI assistants)             │
└─────────────────────┬───────────────────────────────────────┘
                      │ MCP Protocol
┌─────────────────────▼───────────────────────────────────────┐
│                  MCP Orchestrator                           │
│          (src/mcp_orchestrator.py)                          │
│  - Context switching between projects                       │
│  - Command routing                                          │
│  - Agile/Scrum logic                                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                   Jira Client                               │
│            (src/jira_client.py)                             │
│  - REST API interactions                                    │
│  - Authentication handling                                  │
│  - Rate limiting                                            │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────────────┐
│              Jira Cloud REST API                            │
│         bodywave.atlassian.net                              │
└─────────────────────────────────────────────────────────────┘
```

## Jira Environment

- **Platform**: Jira Cloud (Private spaces)
- **Domain**: `bodywave.atlassian.net`
- **Methodology**: Scrum
- **Authentication**: API Token (with OAuth 2.0 migration path)

## Agile Configuration

### Program Increments (PIs)
- **4 PIs per year** (Quarterly cadence)
- PI naming convention: `PI-YYYY-Q#` (e.g., `PI-2025-Q1`)

### Sprints
- **4 to 6 sprints per PI**
- Each project can have its own velocity and sprint cycle
- Sprint naming convention: `{Project}-Sprint-{PI}-{#}` (e.g., `BCM-Sprint-PI2025Q1-3`)

### Current Projects
1. **BCM Cloud** - Healthcare SaaS platform
2. **Brainsway Infra** - AWS Infrastructure management

## Development Standards

### Python Version
- **Minimum**: Python 3.13+
- Use modern Python features (match statements, type hints, dataclasses)

### Code Style
- Use `ruff` for linting and formatting
- Follow PEP 8 with 100 character line limit
- Type hints required for all public functions
- Docstrings required for all modules, classes, and public functions

### File Structure
```
bodywave-jira/
├── src/
│   ├── __init__.py
│   ├── jira_client.py      # Jira REST API client
│   ├── mcp_orchestrator.py # MCP server logic
│   ├── agile_manager.py    # PI/Sprint management
│   ├── models.py           # Data models (dataclasses)
│   └── config.py           # Configuration management
├── tests/
│   ├── __init__.py
│   ├── test_jira_client.py
│   ├── test_orchestrator.py
│   └── test_agile_manager.py
├── config/
│   └── projects.json       # Project definitions
├── main.py                 # Entry point / verification script
├── pyproject.toml          # Project configuration
├── .env.example            # Environment variable template
├── CLAUDE.md               # This file
└── README.md               # User documentation
```

### Configuration Management
- **Secrets**: Use `.env` file (never commit)
- **Project configs**: Use `config/projects.json`
- **Environment variables** take precedence over config files

### Required Environment Variables
```bash
JIRA_BASE_URL=https://bodywave.atlassian.net
JIRA_USER_EMAIL=your-email@bodywave.com
JIRA_API_TOKEN=your-api-token
```

## API Design Principles

### Jira Client
- All methods should be stateless where possible
- Return typed dataclasses, not raw dictionaries
- Handle pagination automatically for list operations
- Include retry logic with exponential backoff
- Log all API calls at DEBUG level

### MCP Orchestrator
- Each command should be idempotent where possible
- Support context switching between projects
- Validate inputs before making API calls
- Return structured responses for AI agent consumption

## Error Handling

- Use custom exception classes (see `src/exceptions.py`)
- Never swallow exceptions silently
- Log errors with full context
- Return meaningful error messages to agents

## Testing Requirements

- Unit tests for all client methods (mocked API responses)
- Integration tests against sandbox Jira (if available)
- Use pytest with pytest-asyncio for async tests
- Minimum 80% code coverage target

## Security Guidelines

1. **Never hardcode credentials**
2. **Never log sensitive data** (tokens, passwords)
3. **Validate all inputs** before API calls
4. **Use HTTPS only** for all Jira communications
5. **API tokens should have minimal required scopes**

## Authentication Strategy

### Current: API Token
```python
# Base64 encode email:token
auth_string = base64.b64encode(f"{email}:{token}".encode()).decode()
headers = {"Authorization": f"Basic {auth_string}"}
```

### Future: OAuth 2.0 (3LO)
The codebase is designed to support migration to OAuth 2.0 when needed:
- `JiraClient` accepts an abstract `AuthProvider`
- Token refresh logic is isolated in `auth.py`
- See `src/auth.py` for the authentication abstraction

## Common Commands

```bash
# Install dependencies
uv pip install -e .

# Run tests
pytest tests/ -v

# Run linting
ruff check src/ tests/

# Run type checking
mypy src/

# Run verification script
python main.py --verify

# Start MCP server
python -m src.mcp_orchestrator
```

## Jira API Reference

### Key Endpoints Used
- `GET /rest/api/3/issue/{issueKey}` - Get issue
- `POST /rest/api/3/issue` - Create issue
- `PUT /rest/api/3/issue/{issueKey}` - Update issue
- `DELETE /rest/api/3/issue/{issueKey}` - Delete issue
- `GET /rest/api/3/search` - Search with JQL
- `GET /rest/api/3/project/{projectKey}` - Get project
- `GET /rest/agile/1.0/board/{boardId}/sprint` - Get sprints
- `POST /rest/agile/1.0/sprint` - Create sprint

### JQL Patterns
```jql
# Issues in current sprint
project = BCM AND sprint in openSprints()

# Issues in specific PI
project = BCM AND labels = "PI-2025-Q1"

# Unassigned issues
project = BCM AND assignee is EMPTY

# Issues updated this week
project = BCM AND updated >= startOfWeek()
```

## Debugging Tips

1. **Enable debug logging**: `LOG_LEVEL=DEBUG python main.py`
2. **Check API responses**: Raw responses logged at TRACE level
3. **Verify auth**: Use `--verify-auth` flag to test credentials
4. **Rate limits**: Watch for 429 responses, backoff is automatic

## Contact

- **Workspace**: bodywave.atlassian.net
- **Maintainer**: Motty (motty@bodywave.com)
