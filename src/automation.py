"""
Automation workflows for Jira operations.

Provides automated workflows for:
- Sprint lifecycle management (start, close, transitions)
- Issue status automation based on events
- Bulk operations for sprint management
- Scheduled reminders and notifications
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import TYPE_CHECKING, Any, Callable

import structlog

if TYPE_CHECKING:
    from src.jira_client import JiraClient

logger = structlog.get_logger(__name__)


class WorkflowTrigger(Enum):
    """Events that can trigger automation workflows."""

    SPRINT_STARTED = "sprint_started"
    SPRINT_CLOSED = "sprint_closed"
    ISSUE_CREATED = "issue_created"
    ISSUE_TRANSITIONED = "issue_transitioned"
    ISSUE_ASSIGNED = "issue_assigned"
    PR_OPENED = "pr_opened"
    PR_MERGED = "pr_merged"
    SCHEDULED = "scheduled"


class IssueTransition(Enum):
    """Standard Jira issue transitions."""

    TODO = "To Do"
    IN_PROGRESS = "In Progress"
    IN_REVIEW = "In Review"
    DONE = "Done"


@dataclass
class WorkflowRule:
    """Definition of an automation rule."""

    name: str
    trigger: WorkflowTrigger
    conditions: dict[str, Any] = field(default_factory=dict)
    actions: list[dict[str, Any]] = field(default_factory=list)
    enabled: bool = True


@dataclass
class WorkflowExecution:
    """Record of a workflow execution."""

    rule_name: str
    trigger: WorkflowTrigger
    started_at: datetime
    completed_at: datetime | None = None
    success: bool = False
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class AutomationEngine:
    """Engine for executing automation workflows."""

    def __init__(self, client: "JiraClient") -> None:
        """Initialize the automation engine.

        Args:
            client: Jira API client.
        """
        self.client = client
        self.rules: dict[str, WorkflowRule] = {}
        self.executions: list[WorkflowExecution] = []
        self._handlers: dict[WorkflowTrigger, list[Callable]] = {}

    def register_rule(self, rule: WorkflowRule) -> None:
        """Register an automation rule.

        Args:
            rule: The workflow rule to register.
        """
        self.rules[rule.name] = rule
        logger.info("Registered automation rule", name=rule.name, trigger=rule.trigger.value)

    def register_handler(
        self, trigger: WorkflowTrigger, handler: Callable
    ) -> None:
        """Register a handler function for a trigger.

        Args:
            trigger: The trigger event.
            handler: The handler function to execute.
        """
        if trigger not in self._handlers:
            self._handlers[trigger] = []
        self._handlers[trigger].append(handler)

    async def execute_trigger(
        self, trigger: WorkflowTrigger, context: dict[str, Any]
    ) -> list[WorkflowExecution]:
        """Execute all rules matching a trigger.

        Args:
            trigger: The trigger event.
            context: Context data for the execution.

        Returns:
            List of workflow executions.
        """
        executions = []

        for rule in self.rules.values():
            if rule.trigger != trigger or not rule.enabled:
                continue

            if not self._check_conditions(rule.conditions, context):
                continue

            execution = await self._execute_rule(rule, context)
            executions.append(execution)
            self.executions.append(execution)

        # Also execute registered handlers
        for handler in self._handlers.get(trigger, []):
            try:
                await handler(context)
            except Exception as e:
                logger.error("Handler execution failed", trigger=trigger.value, error=str(e))

        return executions

    def _check_conditions(
        self, conditions: dict[str, Any], context: dict[str, Any]
    ) -> bool:
        """Check if conditions are met.

        Args:
            conditions: Conditions to check.
            context: Context data.

        Returns:
            True if all conditions are met.
        """
        for key, expected in conditions.items():
            actual = context.get(key)
            if actual != expected:
                return False
        return True

    async def _execute_rule(
        self, rule: WorkflowRule, context: dict[str, Any]
    ) -> WorkflowExecution:
        """Execute a single workflow rule.

        Args:
            rule: The rule to execute.
            context: Context data.

        Returns:
            Execution record.
        """
        execution = WorkflowExecution(
            rule_name=rule.name,
            trigger=rule.trigger,
            started_at=datetime.now(),
        )

        try:
            result = {}
            for action in rule.actions:
                action_result = await self._execute_action(action, context)
                result.update(action_result)

            execution.success = True
            execution.result = result
            logger.info("Rule executed successfully", rule=rule.name)

        except Exception as e:
            execution.success = False
            execution.error = str(e)
            logger.error("Rule execution failed", rule=rule.name, error=str(e))

        finally:
            execution.completed_at = datetime.now()

        return execution

    async def _execute_action(
        self, action: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute a single action.

        Args:
            action: Action definition.
            context: Context data.

        Returns:
            Action result.
        """
        action_type = action.get("type")

        if action_type == "transition_issue":
            return await self._action_transition_issue(action, context)
        elif action_type == "add_comment":
            return await self._action_add_comment(action, context)
        elif action_type == "update_field":
            return await self._action_update_field(action, context)
        elif action_type == "move_to_sprint":
            return await self._action_move_to_sprint(action, context)
        else:
            logger.warning("Unknown action type", type=action_type)
            return {}

    async def _action_transition_issue(
        self, action: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        """Transition an issue to a new status.

        Args:
            action: Action definition with 'to_status'.
            context: Context with 'issue_key'.

        Returns:
            Result with transition details.
        """
        issue_key = context.get("issue_key") or action.get("issue_key")
        to_status = action.get("to_status")

        if not issue_key or not to_status:
            return {"error": "Missing issue_key or to_status"}

        await self.client.transition_issue(issue_key, to_status)
        return {"transitioned": issue_key, "to_status": to_status}

    async def _action_add_comment(
        self, action: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        """Add a comment to an issue.

        Args:
            action: Action definition with 'comment'.
            context: Context with 'issue_key'.

        Returns:
            Result with comment details.
        """
        issue_key = context.get("issue_key") or action.get("issue_key")
        comment = action.get("comment", "")

        # Template substitution
        for key, value in context.items():
            comment = comment.replace(f"{{{key}}}", str(value))

        if not issue_key:
            return {"error": "Missing issue_key"}

        await self.client.add_comment(issue_key, comment)
        return {"commented": issue_key}

    async def _action_update_field(
        self, action: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        """Update a field on an issue.

        Args:
            action: Action definition with 'field' and 'value'.
            context: Context with 'issue_key'.

        Returns:
            Result with update details.
        """
        issue_key = context.get("issue_key") or action.get("issue_key")
        field_name = action.get("field")
        value = action.get("value")

        if not issue_key or not field_name:
            return {"error": "Missing issue_key or field"}

        await self.client.update_issue(issue_key, {field_name: value})
        return {"updated": issue_key, "field": field_name}

    async def _action_move_to_sprint(
        self, action: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        """Move issues to a sprint.

        Args:
            action: Action definition with 'sprint_id'.
            context: Context with 'issue_keys'.

        Returns:
            Result with moved issues.
        """
        issue_keys = context.get("issue_keys", [])
        sprint_id = action.get("sprint_id") or context.get("sprint_id")

        if not sprint_id or not issue_keys:
            return {"error": "Missing sprint_id or issue_keys"}

        await self.client.move_issues_to_sprint(sprint_id, issue_keys)
        return {"moved": issue_keys, "sprint_id": sprint_id}


class SprintAutomation:
    """Automation workflows for sprint management."""

    def __init__(self, engine: AutomationEngine) -> None:
        """Initialize sprint automation.

        Args:
            engine: The automation engine.
        """
        self.engine = engine
        self._setup_rules()

    def _setup_rules(self) -> None:
        """Set up default sprint automation rules."""
        # Rule: Move incomplete issues when sprint closes
        self.engine.register_rule(
            WorkflowRule(
                name="move_incomplete_to_backlog",
                trigger=WorkflowTrigger.SPRINT_CLOSED,
                actions=[
                    {
                        "type": "add_comment",
                        "comment": "Moved to backlog - sprint {sprint_name} closed",
                    }
                ],
            )
        )

        # Rule: Notify on sprint start
        self.engine.register_rule(
            WorkflowRule(
                name="sprint_start_notification",
                trigger=WorkflowTrigger.SPRINT_STARTED,
                actions=[
                    {
                        "type": "add_comment",
                        "comment": "Sprint {sprint_name} has started!",
                    }
                ],
            )
        )

    async def on_sprint_start(
        self, sprint_id: int, sprint_name: str, issue_keys: list[str]
    ) -> None:
        """Handle sprint start event.

        Args:
            sprint_id: The sprint ID.
            sprint_name: The sprint name.
            issue_keys: Issues in the sprint.
        """
        context = {
            "sprint_id": sprint_id,
            "sprint_name": sprint_name,
            "issue_keys": issue_keys,
        }
        await self.engine.execute_trigger(WorkflowTrigger.SPRINT_STARTED, context)

    async def on_sprint_close(
        self,
        sprint_id: int,
        sprint_name: str,
        completed_keys: list[str],
        incomplete_keys: list[str],
    ) -> None:
        """Handle sprint close event.

        Args:
            sprint_id: The sprint ID.
            sprint_name: The sprint name.
            completed_keys: Completed issue keys.
            incomplete_keys: Incomplete issue keys.
        """
        context = {
            "sprint_id": sprint_id,
            "sprint_name": sprint_name,
            "completed_keys": completed_keys,
            "incomplete_keys": incomplete_keys,
        }
        await self.engine.execute_trigger(WorkflowTrigger.SPRINT_CLOSED, context)


class IssueAutomation:
    """Automation workflows for issue management."""

    def __init__(self, engine: AutomationEngine) -> None:
        """Initialize issue automation.

        Args:
            engine: The automation engine.
        """
        self.engine = engine
        self._setup_rules()

    def _setup_rules(self) -> None:
        """Set up default issue automation rules."""
        # Rule: Auto-transition on PR opened
        self.engine.register_rule(
            WorkflowRule(
                name="pr_opens_in_review",
                trigger=WorkflowTrigger.PR_OPENED,
                actions=[
                    {"type": "transition_issue", "to_status": IssueTransition.IN_REVIEW.value}
                ],
            )
        )

        # Rule: Auto-transition on PR merged
        self.engine.register_rule(
            WorkflowRule(
                name="pr_merges_done",
                trigger=WorkflowTrigger.PR_MERGED,
                actions=[
                    {"type": "transition_issue", "to_status": IssueTransition.DONE.value},
                    {"type": "add_comment", "comment": "Completed via PR merge: {pr_url}"},
                ],
            )
        )

    async def on_pr_opened(self, issue_key: str, pr_url: str, pr_title: str) -> None:
        """Handle PR opened event.

        Args:
            issue_key: The linked Jira issue.
            pr_url: URL of the PR.
            pr_title: Title of the PR.
        """
        context = {
            "issue_key": issue_key,
            "pr_url": pr_url,
            "pr_title": pr_title,
        }
        await self.engine.execute_trigger(WorkflowTrigger.PR_OPENED, context)

    async def on_pr_merged(self, issue_key: str, pr_url: str) -> None:
        """Handle PR merged event.

        Args:
            issue_key: The linked Jira issue.
            pr_url: URL of the PR.
        """
        context = {
            "issue_key": issue_key,
            "pr_url": pr_url,
        }
        await self.engine.execute_trigger(WorkflowTrigger.PR_MERGED, context)


class BulkOperations:
    """Bulk operations for Jira issues."""

    def __init__(self, client: "JiraClient") -> None:
        """Initialize bulk operations.

        Args:
            client: Jira API client.
        """
        self.client = client

    async def bulk_transition(
        self, issue_keys: list[str], to_status: str
    ) -> dict[str, bool]:
        """Transition multiple issues.

        Args:
            issue_keys: List of issue keys.
            to_status: Target status.

        Returns:
            Dict mapping issue key to success status.
        """
        results = {}

        for key in issue_keys:
            try:
                await self.client.transition_issue(key, to_status)
                results[key] = True
                logger.info("Transitioned issue", key=key, to=to_status)
            except Exception as e:
                results[key] = False
                logger.error("Failed to transition", key=key, error=str(e))

        return results

    async def bulk_assign(
        self, issue_keys: list[str], assignee: str
    ) -> dict[str, bool]:
        """Assign multiple issues to a user.

        Args:
            issue_keys: List of issue keys.
            assignee: Assignee account ID or email.

        Returns:
            Dict mapping issue key to success status.
        """
        results = {}

        for key in issue_keys:
            try:
                await self.client.update_issue(key, {"assignee": {"accountId": assignee}})
                results[key] = True
                logger.info("Assigned issue", key=key, assignee=assignee)
            except Exception as e:
                results[key] = False
                logger.error("Failed to assign", key=key, error=str(e))

        return results

    async def bulk_add_labels(
        self, issue_keys: list[str], labels: list[str]
    ) -> dict[str, bool]:
        """Add labels to multiple issues.

        Args:
            issue_keys: List of issue keys.
            labels: Labels to add.

        Returns:
            Dict mapping issue key to success status.
        """
        results = {}

        for key in issue_keys:
            try:
                # Get current labels
                issue = await self.client.get_issue(key)
                current_labels = issue.get("fields", {}).get("labels", [])
                new_labels = list(set(current_labels + labels))

                await self.client.update_issue(key, {"labels": new_labels})
                results[key] = True
                logger.info("Added labels", key=key, labels=labels)
            except Exception as e:
                results[key] = False
                logger.error("Failed to add labels", key=key, error=str(e))

        return results

    async def bulk_move_to_sprint(
        self, issue_keys: list[str], sprint_id: int
    ) -> bool:
        """Move multiple issues to a sprint.

        Args:
            issue_keys: List of issue keys.
            sprint_id: Target sprint ID.

        Returns:
            True if successful.
        """
        try:
            await self.client.move_issues_to_sprint(sprint_id, issue_keys)
            logger.info("Moved issues to sprint", count=len(issue_keys), sprint=sprint_id)
            return True
        except Exception as e:
            logger.error("Failed to move issues", error=str(e))
            return False


class ScheduledTasks:
    """Scheduled automation tasks."""

    def __init__(self, engine: AutomationEngine) -> None:
        """Initialize scheduled tasks.

        Args:
            engine: The automation engine.
        """
        self.engine = engine
        self._running = False
        self._tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        """Start scheduled tasks."""
        self._running = True
        logger.info("Starting scheduled tasks")

    async def stop(self) -> None:
        """Stop scheduled tasks."""
        self._running = False
        for task in self._tasks:
            task.cancel()
        logger.info("Stopped scheduled tasks")

    async def check_stale_issues(
        self, project_key: str, days_stale: int = 7
    ) -> list[str]:
        """Find issues that haven't been updated recently.

        Args:
            project_key: The project key.
            days_stale: Number of days to consider stale.

        Returns:
            List of stale issue keys.
        """
        stale_date = datetime.now() - timedelta(days=days_stale)
        date_str = stale_date.strftime("%Y-%m-%d")

        jql = f'project = {project_key} AND status != Done AND updated < "{date_str}"'

        try:
            results = await self.engine.client.search_issues(jql)
            issue_keys = [issue["key"] for issue in results.get("issues", [])]
            logger.info("Found stale issues", count=len(issue_keys), project=project_key)
            return issue_keys
        except Exception as e:
            logger.error("Failed to find stale issues", error=str(e))
            return []

    async def check_sprint_capacity(
        self, board_id: int, sprint_id: int
    ) -> dict[str, Any]:
        """Check sprint capacity and workload.

        Args:
            board_id: The board ID.
            sprint_id: The sprint ID.

        Returns:
            Capacity metrics.
        """
        try:
            issues = await self.engine.client.get_sprint_issues(board_id, sprint_id)
            issue_list = issues.get("issues", [])

            total_points = 0
            by_status: dict[str, int] = {}

            for issue in issue_list:
                fields = issue.get("fields", {})
                points = fields.get("customfield_10016", 0) or 0  # Story points field
                total_points += points

                status = fields.get("status", {}).get("name", "Unknown")
                by_status[status] = by_status.get(status, 0) + 1

            return {
                "sprint_id": sprint_id,
                "total_issues": len(issue_list),
                "total_points": total_points,
                "by_status": by_status,
            }
        except Exception as e:
            logger.error("Failed to check capacity", error=str(e))
            return {}
