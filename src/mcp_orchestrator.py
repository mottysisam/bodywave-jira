"""
MCP (Master Control Program) Orchestrator for the Bodywave Jira Server.

This module provides the orchestration layer that enables AI agents to
interact with Jira through structured commands. It handles context
switching between projects, command routing, and response formatting.
"""

import asyncio
import json
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any

import structlog

from src.agile_manager import AgileManager
from src.config import Config, ProjectsConfig, load_config, load_projects_config
from src.exceptions import JiraError, ProjectNotFoundError, ValidationError
from src.jira_client import JiraClient
from src.models import Issue, ProgramIncrement, Project, Sprint

logger = structlog.get_logger(__name__)


class CommandType(str, Enum):
    """Available MCP commands."""

    # Issue commands
    CREATE_ISSUE = "create_issue"
    GET_ISSUE = "get_issue"
    UPDATE_ISSUE = "update_issue"
    DELETE_ISSUE = "delete_issue"
    SEARCH_ISSUES = "search_issues"
    TRANSITION_ISSUE = "transition_issue"
    ADD_COMMENT = "add_comment"

    # Sprint commands
    GET_CURRENT_SPRINT = "get_current_sprint"
    LIST_SPRINTS = "list_sprints"
    CREATE_SPRINT = "create_sprint"
    START_SPRINT = "start_sprint"
    CLOSE_SPRINT = "close_sprint"
    ADD_TO_SPRINT = "add_to_sprint"

    # PI commands
    GET_CURRENT_PI = "get_current_pi"
    GET_PI_SPRINTS = "get_pi_sprints"
    CREATE_PI_SPRINTS = "create_pi_sprints"

    # Project commands
    LIST_PROJECTS = "list_projects"
    GET_PROJECT = "get_project"
    CREATE_PROJECT = "create_project"
    SWITCH_PROJECT = "switch_project"

    # Metrics commands
    GET_VELOCITY = "get_velocity"
    GET_SPRINT_SUMMARY = "get_sprint_summary"

    # Utility commands
    VERIFY_CONNECTION = "verify_connection"
    GET_STATUS = "get_status"


@dataclass
class MCPCommand:
    """Represents a command to execute."""

    type: CommandType
    params: dict[str, Any] = field(default_factory=dict)
    project_key: str | None = None


@dataclass
class MCPResponse:
    """Response from MCP command execution."""

    success: bool
    data: Any = None
    error: str | None = None
    command_type: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result: dict[str, Any] = {
            "success": self.success,
            "command": self.command_type,
        }
        if self.success:
            result["data"] = self._serialize_data(self.data)
        else:
            result["error"] = self.error
        return result

    def _serialize_data(self, data: Any) -> Any:
        """Serialize data for JSON output."""
        if data is None:
            return None
        if isinstance(data, (str, int, float, bool)):
            return data
        if isinstance(data, date):
            return data.isoformat()
        if isinstance(data, list):
            return [self._serialize_data(item) for item in data]
        if isinstance(data, dict):
            return {k: self._serialize_data(v) for k, v in data.items()}
        if hasattr(data, "model_dump"):
            return data.model_dump()
        if hasattr(data, "__dict__"):
            return {k: self._serialize_data(v) for k, v in data.__dict__.items()}
        return str(data)

    def to_json(self) -> str:
        """Convert to JSON string."""
        return json.dumps(self.to_dict(), indent=2, default=str)


class MCPOrchestrator:
    """Orchestrates AI agent commands to Jira.

    The orchestrator maintains context (current project, PI, sprint)
    and routes commands to the appropriate handlers.

    Usage:
        orchestrator = MCPOrchestrator()
        await orchestrator.initialize()

        # Execute a command
        response = await orchestrator.execute(MCPCommand(
            type=CommandType.CREATE_ISSUE,
            params={"summary": "New task", "issue_type": "Task"},
            project_key="BCM"
        ))

        # Or use the execute_raw method for string input
        response = await orchestrator.execute_raw({
            "command": "create_issue",
            "project": "BCM",
            "summary": "New task"
        })
    """

    def __init__(
        self,
        config: Config | None = None,
        projects_config: ProjectsConfig | None = None,
    ) -> None:
        """Initialize the orchestrator.

        Args:
            config: Application config (loads from env if None).
            projects_config: Projects config (loads from file if None).
        """
        self._config = config or load_config()
        self._projects_config = projects_config or load_projects_config()
        self._client: JiraClient | None = None
        self._agile: AgileManager | None = None
        self._current_project_key: str | None = None
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize the orchestrator and verify connection."""
        if self._initialized:
            return

        self._client = JiraClient(self._config)
        await self._client.verify_connection()

        self._agile = AgileManager(self._client, self._projects_config)

        # Set default project if available
        if self._projects_config.projects:
            self._current_project_key = self._projects_config.projects[0].key

        self._initialized = True
        logger.info(
            "MCP Orchestrator initialized",
            default_project=self._current_project_key,
            available_projects=self._projects_config.project_keys,
        )

    async def close(self) -> None:
        """Close connections and cleanup."""
        if self._client:
            await self._client.close()
        self._initialized = False

    async def __aenter__(self) -> "MCPOrchestrator":
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()

    @property
    def current_project(self) -> str | None:
        """Get current project key."""
        return self._current_project_key

    @property
    def is_initialized(self) -> bool:
        """Check if orchestrator is initialized."""
        return self._initialized

    def _ensure_initialized(self) -> None:
        """Ensure orchestrator is initialized."""
        if not self._initialized:
            raise RuntimeError("Orchestrator not initialized. Call initialize() first.")

    def _get_project_key(self, command: MCPCommand) -> str:
        """Get project key from command or current context."""
        key = command.project_key or self._current_project_key
        if not key:
            raise ValidationError("No project specified and no default project set")
        return key

    async def execute(self, command: MCPCommand) -> MCPResponse:
        """Execute an MCP command.

        Args:
            command: Command to execute.

        Returns:
            MCPResponse with result or error.
        """
        self._ensure_initialized()

        logger.info(
            "Executing command",
            command_type=command.type,
            project=command.project_key,
        )

        try:
            handler = self._get_handler(command.type)
            result = await handler(command)
            return MCPResponse(
                success=True,
                data=result,
                command_type=command.type.value,
            )
        except JiraError as e:
            logger.error(
                "Command failed",
                command_type=command.type,
                error=str(e),
            )
            return MCPResponse(
                success=False,
                error=str(e),
                command_type=command.type.value,
            )
        except Exception as e:
            logger.exception("Unexpected error executing command")
            return MCPResponse(
                success=False,
                error=f"Unexpected error: {str(e)}",
                command_type=command.type.value,
            )

    async def execute_raw(self, raw_command: dict[str, Any]) -> MCPResponse:
        """Execute a command from raw dictionary input.

        This is useful for AI agents that send JSON commands.

        Args:
            raw_command: Dictionary with "command" and other params.

        Returns:
            MCPResponse with result or error.
        """
        try:
            command_str = raw_command.pop("command", None)
            if not command_str:
                return MCPResponse(
                    success=False,
                    error="Missing 'command' field",
                )

            try:
                command_type = CommandType(command_str)
            except ValueError:
                valid = [c.value for c in CommandType]
                return MCPResponse(
                    success=False,
                    error=f"Invalid command '{command_str}'. Valid: {valid}",
                )

            project_key = raw_command.pop("project", None) or raw_command.pop("project_key", None)

            command = MCPCommand(
                type=command_type,
                params=raw_command,
                project_key=project_key,
            )

            return await self.execute(command)

        except Exception as e:
            return MCPResponse(
                success=False,
                error=f"Failed to parse command: {str(e)}",
            )

    def _get_handler(self, command_type: CommandType) -> Any:
        """Get the handler function for a command type."""
        handlers = {
            # Issue commands
            CommandType.CREATE_ISSUE: self._handle_create_issue,
            CommandType.GET_ISSUE: self._handle_get_issue,
            CommandType.UPDATE_ISSUE: self._handle_update_issue,
            CommandType.DELETE_ISSUE: self._handle_delete_issue,
            CommandType.SEARCH_ISSUES: self._handle_search_issues,
            CommandType.TRANSITION_ISSUE: self._handle_transition_issue,
            CommandType.ADD_COMMENT: self._handle_add_comment,
            # Sprint commands
            CommandType.GET_CURRENT_SPRINT: self._handle_get_current_sprint,
            CommandType.LIST_SPRINTS: self._handle_list_sprints,
            CommandType.CREATE_SPRINT: self._handle_create_sprint,
            CommandType.START_SPRINT: self._handle_start_sprint,
            CommandType.CLOSE_SPRINT: self._handle_close_sprint,
            CommandType.ADD_TO_SPRINT: self._handle_add_to_sprint,
            # PI commands
            CommandType.GET_CURRENT_PI: self._handle_get_current_pi,
            CommandType.GET_PI_SPRINTS: self._handle_get_pi_sprints,
            CommandType.CREATE_PI_SPRINTS: self._handle_create_pi_sprints,
            # Project commands
            CommandType.LIST_PROJECTS: self._handle_list_projects,
            CommandType.GET_PROJECT: self._handle_get_project,
            CommandType.CREATE_PROJECT: self._handle_create_project,
            CommandType.SWITCH_PROJECT: self._handle_switch_project,
            # Metrics commands
            CommandType.GET_VELOCITY: self._handle_get_velocity,
            CommandType.GET_SPRINT_SUMMARY: self._handle_get_sprint_summary,
            # Utility commands
            CommandType.VERIFY_CONNECTION: self._handle_verify_connection,
            CommandType.GET_STATUS: self._handle_get_status,
        }
        return handlers[command_type]

    # ========================================================================
    # Issue Handlers
    # ========================================================================

    async def _handle_create_issue(self, command: MCPCommand) -> Issue:
        """Handle create_issue command."""
        assert self._client is not None
        project_key = self._get_project_key(command)
        return await self._client.create_issue(
            project_key=project_key,
            summary=command.params["summary"],
            issue_type=command.params.get("issue_type", "Task"),
            description=command.params.get("description"),
            priority=command.params.get("priority"),
            assignee_id=command.params.get("assignee_id"),
            labels=command.params.get("labels"),
            sprint_id=command.params.get("sprint_id"),
            parent_key=command.params.get("parent_key"),
        )

    async def _handle_get_issue(self, command: MCPCommand) -> Issue:
        """Handle get_issue command."""
        assert self._client is not None
        issue_key = command.params["issue_key"]
        return await self._client.get_issue(issue_key)

    async def _handle_update_issue(self, command: MCPCommand) -> Issue:
        """Handle update_issue command."""
        assert self._client is not None
        issue_key = command.params.pop("issue_key")
        return await self._client.update_issue(issue_key, **command.params)

    async def _handle_delete_issue(self, command: MCPCommand) -> dict[str, str]:
        """Handle delete_issue command."""
        assert self._client is not None
        issue_key = command.params["issue_key"]
        await self._client.delete_issue(issue_key)
        return {"deleted": issue_key}

    async def _handle_search_issues(self, command: MCPCommand) -> list[Issue]:
        """Handle search_issues command."""
        assert self._client is not None
        jql = command.params.get("jql")

        if not jql:
            # Build JQL from params
            project_key = self._get_project_key(command)
            conditions = [f"project = {project_key}"]

            if status := command.params.get("status"):
                conditions.append(f'status = "{status}"')
            if sprint := command.params.get("sprint"):
                if sprint == "current":
                    conditions.append("sprint in openSprints()")
                else:
                    conditions.append(f"sprint = {sprint}")
            if assignee := command.params.get("assignee"):
                if assignee == "me":
                    conditions.append("assignee = currentUser()")
                elif assignee == "unassigned":
                    conditions.append("assignee is EMPTY")
                else:
                    conditions.append(f'assignee = "{assignee}"')

            jql = " AND ".join(conditions)

        result = await self._client.search_issues_jql(
            jql=jql,
            max_results=command.params.get("max_results", 50),
        )
        return result.issues

    async def _handle_transition_issue(self, command: MCPCommand) -> Issue:
        """Handle transition_issue command."""
        assert self._client is not None
        return await self._client.transition_issue(
            issue_key=command.params["issue_key"],
            transition_name=command.params["transition"],
        )

    async def _handle_add_comment(self, command: MCPCommand) -> dict[str, str]:
        """Handle add_comment command."""
        assert self._client is not None
        await self._client.add_comment(
            issue_key=command.params["issue_key"],
            body=command.params["comment"],
        )
        return {"status": "comment added"}

    # ========================================================================
    # Sprint Handlers
    # ========================================================================

    async def _handle_get_current_sprint(self, command: MCPCommand) -> Sprint | None:
        """Handle get_current_sprint command."""
        assert self._agile is not None
        project_key = self._get_project_key(command)
        return await self._agile.get_current_sprint(project_key)

    async def _handle_list_sprints(self, command: MCPCommand) -> list[Sprint]:
        """Handle list_sprints command."""
        assert self._agile is not None
        project_key = self._get_project_key(command)
        state = command.params.get("state")  # future, active, closed
        from src.models import SprintState

        state_enum = SprintState(state) if state else None
        return await self._agile.get_project_sprints(project_key, state=state_enum)

    async def _handle_create_sprint(self, command: MCPCommand) -> Sprint:
        """Handle create_sprint command."""
        assert self._client is not None
        return await self._client.create_sprint(
            board_id=command.params["board_id"],
            name=command.params["name"],
            start_date=command.params.get("start_date"),
            end_date=command.params.get("end_date"),
            goal=command.params.get("goal"),
        )

    async def _handle_start_sprint(self, command: MCPCommand) -> Sprint | None:
        """Handle start_sprint command."""
        assert self._agile is not None
        project_key = self._get_project_key(command)
        return await self._agile.start_next_sprint(project_key)

    async def _handle_close_sprint(self, command: MCPCommand) -> Sprint | None:
        """Handle close_sprint command."""
        assert self._agile is not None
        project_key = self._get_project_key(command)
        return await self._agile.close_current_sprint(project_key)

    async def _handle_add_to_sprint(self, command: MCPCommand) -> dict[str, Any]:
        """Handle add_to_sprint command."""
        assert self._client is not None
        sprint_id = command.params["sprint_id"]
        issue_keys = command.params["issue_keys"]
        if isinstance(issue_keys, str):
            issue_keys = [issue_keys]
        await self._client.add_issues_to_sprint(sprint_id, issue_keys)
        return {"sprint_id": sprint_id, "issues_added": issue_keys}

    # ========================================================================
    # PI Handlers
    # ========================================================================

    async def _handle_get_current_pi(self, _command: MCPCommand) -> ProgramIncrement:
        """Handle get_current_pi command."""
        assert self._agile is not None
        return self._agile.get_current_pi()

    async def _handle_get_pi_sprints(self, command: MCPCommand) -> list[Sprint]:
        """Handle get_pi_sprints command."""
        assert self._agile is not None
        project_key = self._get_project_key(command)
        pi = self._agile.get_current_pi()

        # Allow specifying a different PI
        if year := command.params.get("year"):
            quarter = command.params.get("quarter", 1)
            pi = self._agile._create_pi(year, quarter)

        return await self._agile.get_sprints_for_pi(project_key, pi)

    async def _handle_create_pi_sprints(self, command: MCPCommand) -> list[Sprint]:
        """Handle create_pi_sprints command."""
        assert self._agile is not None
        project_key = self._get_project_key(command)
        pi = self._agile.get_current_pi()

        if year := command.params.get("year"):
            quarter = command.params.get("quarter", 1)
            pi = self._agile._create_pi(year, quarter)

        return await self._agile.create_pi_sprints(
            project_key=project_key,
            pi=pi,
            num_sprints=command.params.get("num_sprints"),
        )

    # ========================================================================
    # Project Handlers
    # ========================================================================

    async def _handle_list_projects(self, _command: MCPCommand) -> list[Project]:
        """Handle list_projects command."""
        assert self._client is not None
        return await self._client.list_projects()

    async def _handle_get_project(self, command: MCPCommand) -> Project:
        """Handle get_project command."""
        assert self._client is not None
        project_key = command.params.get("project_key") or self._get_project_key(command)
        return await self._client.get_project(project_key)

    async def _handle_create_project(self, command: MCPCommand) -> Project:
        """Handle create_project command."""
        assert self._client is not None
        return await self._client.create_project(
            key=command.params["key"],
            name=command.params["name"],
            project_type=command.params.get("project_type", "software"),
            description=command.params.get("description"),
            lead_account_id=command.params.get("lead_account_id"),
            template_key=command.params.get("template_key"),
        )

    async def _handle_switch_project(self, command: MCPCommand) -> dict[str, str]:
        """Handle switch_project command."""
        project_key = command.params["project_key"]

        # Verify project exists in config
        if project_key not in self._projects_config.project_keys:
            raise ProjectNotFoundError(project_key)

        self._current_project_key = project_key
        logger.info("Switched project context", project_key=project_key)

        return {
            "previous_project": self._current_project_key,
            "current_project": project_key,
        }

    # ========================================================================
    # Metrics Handlers
    # ========================================================================

    async def _handle_get_velocity(self, command: MCPCommand) -> dict[str, Any]:
        """Handle get_velocity command."""
        assert self._agile is not None
        project_key = self._get_project_key(command)

        if sprint_id := command.params.get("sprint_id"):
            velocity = await self._agile.get_sprint_velocity(sprint_id)
            return {"sprint_id": sprint_id, "velocity": velocity}

        # Return average velocity
        num_sprints = command.params.get("num_sprints", 3)
        velocity = await self._agile.get_average_velocity(project_key, num_sprints)
        return {
            "project": project_key,
            "average_velocity": velocity,
            "sprints_averaged": num_sprints,
        }

    async def _handle_get_sprint_summary(self, command: MCPCommand) -> dict[str, Any]:
        """Handle get_sprint_summary command."""
        assert self._agile is not None
        assert self._client is not None
        project_key = self._get_project_key(command)

        sprint = await self._agile.get_current_sprint(project_key)
        if not sprint:
            return {"error": "No active sprint"}

        issues = await self._agile.get_issues_in_sprint(sprint.id)

        # Group by status
        by_status: dict[str, list[str]] = {}
        for issue in issues:
            status = issue.status
            if status not in by_status:
                by_status[status] = []
            by_status[status].append(issue.key)

        total_points = sum(i.story_points or 0 for i in issues)
        done_points = sum(i.story_points or 0 for i in issues if i.status in ("Done", "Closed"))

        return {
            "sprint": sprint.name,
            "state": sprint.state.value,
            "start_date": sprint.start_date,
            "end_date": sprint.end_date,
            "total_issues": len(issues),
            "total_points": total_points,
            "completed_points": done_points,
            "issues_by_status": by_status,
        }

    # ========================================================================
    # Utility Handlers
    # ========================================================================

    async def _handle_verify_connection(self, _command: MCPCommand) -> dict[str, Any]:
        """Handle verify_connection command."""
        assert self._client is not None
        user = await self._client.get_myself()
        return {
            "connected": True,
            "user": user.get("displayName"),
            "email": user.get("emailAddress"),
        }

    async def _handle_get_status(self, _command: MCPCommand) -> dict[str, Any]:
        """Handle get_status command."""
        assert self._agile is not None
        pi = self._agile.get_current_pi()

        return {
            "initialized": self._initialized,
            "current_project": self._current_project_key,
            "available_projects": self._projects_config.project_keys,
            "current_pi": pi.name,
            "pi_dates": {
                "start": pi.start_date,
                "end": pi.end_date,
            },
        }


def main() -> None:
    """Main entry point for running as a standalone server."""

    async def run() -> None:
        async with MCPOrchestrator() as orchestrator:
            # Example: Print status
            response = await orchestrator.execute(MCPCommand(type=CommandType.GET_STATUS))
            print(response.to_json())

    asyncio.run(run())


if __name__ == "__main__":
    main()
