"""
Session hooks for Claude Code integration.

Provides hooks that execute at session boundaries to:
- Load sprint context on session start
- Display current work items and priorities
- Sync session activity to Jira on session end
- Track time spent on issues
"""

import contextlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from src.jira_client import JiraClient

logger = structlog.get_logger(__name__)

# Default session state file location
SESSION_STATE_FILE = Path.home() / ".bodywave-jira" / "session_state.json"


@dataclass
class SessionContext:
    """Context for the current Claude Code session."""

    session_id: str
    started_at: datetime
    project_key: str | None = None
    sprint_id: int | None = None
    sprint_name: str | None = None
    active_issue: str | None = None
    worked_issues: list[str] = field(default_factory=list)
    time_entries: dict[str, int] = field(default_factory=dict)  # issue_key -> seconds

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "session_id": self.session_id,
            "started_at": self.started_at.isoformat(),
            "project_key": self.project_key,
            "sprint_id": self.sprint_id,
            "sprint_name": self.sprint_name,
            "active_issue": self.active_issue,
            "worked_issues": self.worked_issues,
            "time_entries": self.time_entries,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SessionContext":
        """Create from dictionary."""
        return cls(
            session_id=data["session_id"],
            started_at=datetime.fromisoformat(data["started_at"]),
            project_key=data.get("project_key"),
            sprint_id=data.get("sprint_id"),
            sprint_name=data.get("sprint_name"),
            active_issue=data.get("active_issue"),
            worked_issues=data.get("worked_issues", []),
            time_entries=data.get("time_entries", {}),
        )


@dataclass
class SprintSummary:
    """Summary of sprint status for session context."""

    sprint_id: int
    sprint_name: str
    state: str
    total_issues: int
    completed_issues: int
    in_progress_issues: int
    remaining_issues: int
    total_points: int
    completed_points: int
    days_remaining: int | None = None


@dataclass
class WorkItem:
    """A work item for display in session context."""

    key: str
    summary: str
    status: str
    priority: str
    assignee: str | None
    story_points: int | None = None
    labels: list[str] = field(default_factory=list)


class SessionHooks:
    """Hooks for Claude Code session lifecycle."""

    def __init__(self, client: "JiraClient", state_file: Path | None = None) -> None:
        """Initialize session hooks.

        Args:
            client: Jira API client.
            state_file: Optional custom path for session state.
        """
        self.client = client
        self.state_file = state_file or SESSION_STATE_FILE
        self.current_session: SessionContext | None = None

    async def on_session_start(
        self,
        session_id: str,
        project_key: str | None = None,
        board_id: int | None = None,
    ) -> dict[str, Any]:
        """Execute on session start.

        Loads sprint context and displays current work items.

        Args:
            session_id: Unique session identifier.
            project_key: Optional project to focus on.
            board_id: Optional board ID for sprint info.

        Returns:
            Session context information.
        """
        logger.info("Session starting", session_id=session_id, project=project_key)

        # Create session context
        self.current_session = SessionContext(
            session_id=session_id,
            started_at=datetime.now(),
            project_key=project_key,
        )

        result: dict[str, Any] = {
            "session_id": session_id,
            "started_at": self.current_session.started_at.isoformat(),
        }

        # Load sprint context if board provided
        if board_id:
            sprint_summary = await self._get_active_sprint_summary(board_id)
            if sprint_summary:
                self.current_session.sprint_id = sprint_summary.sprint_id
                self.current_session.sprint_name = sprint_summary.sprint_name
                result["sprint"] = {
                    "id": sprint_summary.sprint_id,
                    "name": sprint_summary.sprint_name,
                    "state": sprint_summary.state,
                    "progress": {
                        "total": sprint_summary.total_issues,
                        "completed": sprint_summary.completed_issues,
                        "in_progress": sprint_summary.in_progress_issues,
                        "remaining": sprint_summary.remaining_issues,
                    },
                    "points": {
                        "total": sprint_summary.total_points,
                        "completed": sprint_summary.completed_points,
                    },
                    "days_remaining": sprint_summary.days_remaining,
                }

        # Load assigned work items
        if project_key:
            work_items = await self._get_my_work_items(project_key)
            result["work_items"] = [
                {
                    "key": item.key,
                    "summary": item.summary,
                    "status": item.status,
                    "priority": item.priority,
                    "story_points": item.story_points,
                }
                for item in work_items
            ]

        # Save session state
        self._save_session_state()

        return result

    async def on_session_end(self) -> dict[str, Any]:
        """Execute on session end.

        Syncs session activity to Jira and saves state.

        Returns:
            Session summary.
        """
        if not self.current_session:
            return {"error": "No active session"}

        logger.info(
            "Session ending",
            session_id=self.current_session.session_id,
            worked_issues=len(self.current_session.worked_issues),
        )

        duration = datetime.now() - self.current_session.started_at
        result = {
            "session_id": self.current_session.session_id,
            "duration_seconds": int(duration.total_seconds()),
            "worked_issues": self.current_session.worked_issues,
            "time_entries": self.current_session.time_entries,
        }

        # Add work log comments to issues
        for issue_key, seconds in self.current_session.time_entries.items():
            if seconds > 60:  # Only log if > 1 minute
                try:
                    await self._add_work_log(issue_key, seconds)
                except Exception as e:
                    logger.error("Failed to add work log", issue=issue_key, error=str(e))

        # Clear session state
        self._clear_session_state()
        self.current_session = None

        return result

    async def on_issue_focus(self, issue_key: str) -> dict[str, Any]:
        """Track when user focuses on an issue.

        Args:
            issue_key: The issue being worked on.

        Returns:
            Issue context.
        """
        if not self.current_session:
            return {"error": "No active session"}

        # Record previous issue time
        if self.current_session.active_issue:
            self._record_time_entry(self.current_session.active_issue)

        # Set new active issue
        self.current_session.active_issue = issue_key
        if issue_key not in self.current_session.worked_issues:
            self.current_session.worked_issues.append(issue_key)

        # Get issue details
        try:
            issue = await self.client.get_issue(issue_key)
            return {
                "key": issue_key,
                "summary": issue.summary,
                "status": issue.status,
                "description": issue.description,
                "focused_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error("Failed to get issue", key=issue_key, error=str(e))
            return {"key": issue_key, "error": str(e)}

    async def get_session_context(self) -> dict[str, Any]:
        """Get current session context.

        Returns:
            Current session state.
        """
        if not self.current_session:
            # Try to load from state file
            saved = self._load_session_state()
            if saved:
                self.current_session = saved
            else:
                return {"active": False}

        duration = datetime.now() - self.current_session.started_at
        return {
            "active": True,
            "session_id": self.current_session.session_id,
            "duration_seconds": int(duration.total_seconds()),
            "project_key": self.current_session.project_key,
            "sprint_name": self.current_session.sprint_name,
            "active_issue": self.current_session.active_issue,
            "worked_issues": self.current_session.worked_issues,
        }

    async def _get_active_sprint_summary(self, board_id: int) -> SprintSummary | None:
        """Get summary of the active sprint.

        Args:
            board_id: The board ID.

        Returns:
            Sprint summary or None.
        """
        try:
            sprints = await self.client.list_sprints(board_id, state="active")
            if not sprints:
                return None

            sprint = sprints[0]
            sprint_id = sprint.id

            # Get sprint issues using JQL
            jql = f"sprint = {sprint_id}"
            result = await self.client.search_issues_jql(jql, max_results=100)
            issue_list = result.issues

            total_points = 0
            completed_points = 0
            status_counts = {"done": 0, "in_progress": 0, "todo": 0}

            for issue in issue_list:
                points = int(issue.story_points or 0)
                total_points += points

                status = issue.status.lower() if issue.status else ""
                if status in ("done", "closed"):
                    status_counts["done"] += 1
                    completed_points += points
                elif status == "in progress":
                    status_counts["in_progress"] += 1
                else:
                    status_counts["todo"] += 1

            # Calculate days remaining
            days_remaining = None
            if sprint.end_date:
                with contextlib.suppress(ValueError, TypeError):
                    days_remaining = (sprint.end_date - date.today()).days

            return SprintSummary(
                sprint_id=sprint_id,
                sprint_name=sprint.name,
                state=sprint.state.value if sprint.state else "unknown",
                total_issues=len(issue_list),
                completed_issues=status_counts["done"],
                in_progress_issues=status_counts["in_progress"],
                remaining_issues=status_counts["todo"],
                total_points=total_points,
                completed_points=completed_points,
                days_remaining=days_remaining,
            )
        except Exception as e:
            logger.error("Failed to get sprint summary", error=str(e))
            return None

    async def _get_my_work_items(self, project_key: str) -> list[WorkItem]:
        """Get work items assigned to current user.

        Args:
            project_key: The project key.

        Returns:
            List of work items.
        """
        try:
            jql = (
                f"project = {project_key} AND assignee = currentUser() "
                f"AND status != Done ORDER BY priority DESC, updated DESC"
            )
            result = await self.client.search_issues_jql(jql, max_results=20)

            work_items = []
            for issue in result.issues:
                work_items.append(
                    WorkItem(
                        key=issue.key,
                        summary=issue.summary,
                        status=issue.status,
                        priority=issue.priority or "Medium",
                        assignee=issue.assignee.display_name if issue.assignee else None,
                        story_points=int(issue.story_points) if issue.story_points else None,
                        labels=issue.labels,
                    )
                )

            return work_items
        except Exception as e:
            logger.error("Failed to get work items", error=str(e))
            return []

    async def _add_work_log(self, issue_key: str, seconds: int) -> None:
        """Add a work log entry to an issue.

        Args:
            issue_key: The issue key.
            seconds: Time spent in seconds.
        """
        minutes = seconds // 60
        comment = f"Worked on this issue during Claude Code session ({minutes} minutes)"
        await self.client.add_comment(issue_key, comment)

    def _record_time_entry(self, issue_key: str) -> None:
        """Record time spent on an issue.

        Args:
            issue_key: The issue key.
        """
        if not self.current_session:
            return

        # This is a simplified time tracking
        # In practice, you'd track actual focus time
        current = self.current_session.time_entries.get(issue_key, 0)
        # Add 5 minutes as minimum work increment
        self.current_session.time_entries[issue_key] = current + 300

    def _save_session_state(self) -> None:
        """Save session state to file."""
        if not self.current_session:
            return

        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.state_file, "w") as f:
                json.dump(self.current_session.to_dict(), f, indent=2)
            logger.debug("Session state saved", file=str(self.state_file))
        except Exception as e:
            logger.error("Failed to save session state", error=str(e))

    def _load_session_state(self) -> SessionContext | None:
        """Load session state from file.

        Returns:
            Saved session context or None.
        """
        try:
            if self.state_file.exists():
                with open(self.state_file) as f:
                    data = json.load(f)
                return SessionContext.from_dict(data)
        except Exception as e:
            logger.error("Failed to load session state", error=str(e))
        return None

    def _clear_session_state(self) -> None:
        """Clear saved session state."""
        try:
            if self.state_file.exists():
                self.state_file.unlink()
            logger.debug("Session state cleared")
        except Exception as e:
            logger.error("Failed to clear session state", error=str(e))


def generate_session_greeting(context: dict[str, Any]) -> str:
    """Generate a greeting message for session start.

    Args:
        context: Session context from on_session_start.

    Returns:
        Formatted greeting message.
    """
    lines = ["# Session Started"]
    lines.append("")

    if "sprint" in context:
        sprint = context["sprint"]
        progress = sprint.get("progress", {})
        points = sprint.get("points", {})

        lines.append(f"## Active Sprint: {sprint['name']}")
        lines.append("")
        lines.append(f"- **Status**: {sprint['state']}")
        lines.append(f"- **Issues**: {progress['completed']}/{progress['total']} completed")
        lines.append(f"- **Points**: {points['completed']}/{points['total']} completed")
        if sprint.get("days_remaining") is not None:
            lines.append(f"- **Days Remaining**: {sprint['days_remaining']}")
        lines.append("")

    if "work_items" in context and context["work_items"]:
        lines.append("## Your Work Items")
        lines.append("")
        for item in context["work_items"][:5]:  # Top 5
            status_emoji = (
                "🔴"
                if item["status"] == "To Do"
                else "🟡"
                if item["status"] == "In Progress"
                else "🟢"
            )
            lines.append(f"- {status_emoji} **{item['key']}**: {item['summary']}")
        lines.append("")

    return "\n".join(lines)


def generate_session_summary(context: dict[str, Any]) -> str:
    """Generate a summary message for session end.

    Args:
        context: Session context from on_session_end.

    Returns:
        Formatted summary message.
    """
    lines = ["# Session Summary"]
    lines.append("")

    duration_mins = context.get("duration_seconds", 0) // 60
    lines.append(f"**Duration**: {duration_mins} minutes")
    lines.append("")

    worked = context.get("worked_issues", [])
    if worked:
        lines.append("## Issues Worked On")
        lines.append("")
        for issue_key in worked:
            time_secs = context.get("time_entries", {}).get(issue_key, 0)
            time_mins = time_secs // 60
            lines.append(f"- **{issue_key}**: {time_mins} minutes")
        lines.append("")

    return "\n".join(lines)
