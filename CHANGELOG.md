# Changelog

All notable changes to the Bodywave Jira MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-05

Initial release of the Bodywave Jira MCP Server.

### Added

#### Core Infrastructure (MGMT-2, MGMT-3, MGMT-4)
- GitHub repository structure with proper Python project layout
- Python 3.13+ project configuration with `uv` package manager
- CI/CD pipeline with GitHub Actions:
  - Linting with `ruff`
  - Type checking with `mypy`
  - Testing with `pytest` and coverage
  - Security scanning with `bandit`
  - Automated releases on version tags

#### Jira API Clients (MGMT-5, MGMT-6)
- REST API client (`src/jira_client.py`):
  - Issue CRUD operations
  - JQL search
  - Project and board management
  - Comments and transitions
  - Rate limiting and retry logic
- Agile API client (`src/agile_manager.py`):
  - Sprint management
  - Board operations
  - Backlog manipulation

#### MCP Server (MGMT-7)
- MCP orchestrator (`src/mcp_orchestrator.py`):
  - Multi-project support
  - Command routing
  - Context management

#### GitHub Integration (MGMT-8)
- GitHub-Jira linking (`src/github_integration.py`):
  - Extract Jira ticket IDs from branches, commits, PR titles
  - Validate commit messages and branch names
  - Format GitHub context as Jira comments
  - Link PRs to referenced tickets
- GitHub Actions workflow for PR-to-Jira sync

#### Automation Workflows (MGMT-9)
- Automation engine (`src/automation.py`):
  - Rule-based workflow execution
  - Sprint lifecycle events (start/close)
  - PR-triggered issue transitions
  - Bulk operations for batch updates
  - Scheduled task support

#### Scrum Calculator (MGMT-10)
- Sprint calculations (`src/scrum_calculator.py`):
  - Sprint date calculations
  - Velocity tracking
  - Capacity planning

#### Session Hooks (MGMT-11)
- Session lifecycle management (`src/session_hooks.py`):
  - Load sprint context on session start
  - Track issue focus and time spent
  - Persist session state
  - Generate greeting and summary messages

#### Slash Commands (MGMT-12)
- Claude Code slash commands (`.claude/commands/`):
  - `/sprint-status` - View current sprint progress
  - `/my-issues` - List assigned issues
  - `/create-issue` - Quick issue creation
  - `/backlog` - View product backlog
  - `/transition-issue` - Move issues between statuses
  - `/search` - JQL and keyword search
  - `/standup` - Generate daily standup report
  - `/comment` - Add comments to issues

#### Documentation (MGMT-13)
- Comprehensive README with usage examples
- Engineering guidelines in CLAUDE.md
- This CHANGELOG

### Dependencies
- `httpx>=0.27.0` - HTTP client
- `pydantic>=2.5.0` - Data validation
- `pydantic-settings>=2.1.0` - Settings management
- `python-dotenv>=1.0.0` - Environment variables
- `tenacity>=8.2.0` - Retry logic
- `structlog>=24.1.0` - Structured logging

### Development Dependencies
- `pytest>=8.0.0` - Testing framework
- `pytest-asyncio>=0.23.0` - Async test support
- `pytest-cov>=4.1.0` - Coverage reporting
- `pytest-httpx>=0.30.0` - HTTP mocking
- `ruff>=0.3.0` - Linting and formatting
- `mypy>=1.8.0` - Type checking
- `bandit>=1.7.0` - Security scanning

## Sprint: Q4_PI3_SPRINT1

This release completes all 12 issues in the initial sprint:

| Issue | Title | Status |
|-------|-------|--------|
| MGMT-2 | Set up GitHub repository structure | Done |
| MGMT-3 | Create Python project structure with uv | Done |
| MGMT-4 | Set up CI/CD pipeline with GitHub Actions | Done |
| MGMT-5 | Implement Jira REST API client | Done |
| MGMT-6 | Implement Jira Agile API client | Done |
| MGMT-7 | Build MCP server core | Done |
| MGMT-8 | Create Jira-GitHub integration | Done |
| MGMT-9 | Build automation workflows | Done |
| MGMT-10 | Implement scrum calculator module | Done |
| MGMT-11 | Create SessionStart hook integration | Done |
| MGMT-12 | Build slash command system | Done |
| MGMT-13 | Write comprehensive documentation | Done |

---

[0.1.0]: https://github.com/mottysisam/bodywave-jira/releases/tag/v0.1.0
