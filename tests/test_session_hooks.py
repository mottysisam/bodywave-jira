"""Tests for session hooks."""

import json
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.session_hooks import (
    SessionContext,
    SessionHooks,
    SprintSummary,
    WorkItem,
    generate_session_greeting,
    generate_session_summary,
)


@pytest.fixture
def mock_client() -> MagicMock:
    """Create a mock Jira client."""
    client = MagicMock()
    client.get_issue = AsyncMock(
        return_value={
            "key": "TEST-1",
            "fields": {
                "summary": "Test issue",
                "status": {"name": "In Progress"},
                "description": "Test description",
            },
        }
    )
    client.get_sprints = AsyncMock(
        return_value={
            "values": [
                {
                    "id": 1,
                    "name": "Sprint 1",
                    "state": "active",
                    "endDate": "2025-01-15T00:00:00Z",
                }
            ]
        }
    )
    client.get_sprint_issues = AsyncMock(
        return_value={
            "issues": [
                {
                    "key": "TEST-1",
                    "fields": {
                        "status": {"statusCategory": {"key": "done"}},
                        "customfield_10016": 5,
                    },
                },
                {
                    "key": "TEST-2",
                    "fields": {
                        "status": {"statusCategory": {"key": "indeterminate"}},
                        "customfield_10016": 3,
                    },
                },
            ]
        }
    )
    client.search_issues = AsyncMock(
        return_value={
            "issues": [
                {
                    "key": "TEST-1",
                    "fields": {
                        "summary": "My task",
                        "status": {"name": "To Do"},
                        "priority": {"name": "High"},
                        "assignee": {"displayName": "Test User"},
                        "customfield_10016": 3,
                        "labels": ["backend"],
                    },
                }
            ]
        }
    )
    client.add_comment = AsyncMock()
    return client


@pytest.fixture
def temp_state_file() -> Path:
    """Create a temporary state file path."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        return Path(f.name)


class TestSessionContext:
    """Tests for SessionContext dataclass."""

    def test_create_context(self) -> None:
        """Should create session context."""
        ctx = SessionContext(
            session_id="test-123",
            started_at=datetime.now(),
            project_key="TEST",
        )
        assert ctx.session_id == "test-123"
        assert ctx.project_key == "TEST"
        assert ctx.worked_issues == []

    def test_to_dict(self) -> None:
        """Should convert to dictionary."""
        now = datetime.now()
        ctx = SessionContext(
            session_id="test-123",
            started_at=now,
            project_key="TEST",
            sprint_id=1,
            active_issue="TEST-1",
        )
        data = ctx.to_dict()

        assert data["session_id"] == "test-123"
        assert data["project_key"] == "TEST"
        assert data["sprint_id"] == 1
        assert data["active_issue"] == "TEST-1"
        assert data["started_at"] == now.isoformat()

    def test_from_dict(self) -> None:
        """Should create from dictionary."""
        now = datetime.now()
        data = {
            "session_id": "test-123",
            "started_at": now.isoformat(),
            "project_key": "TEST",
            "sprint_id": 1,
            "sprint_name": "Sprint 1",
            "active_issue": "TEST-1",
            "worked_issues": ["TEST-1", "TEST-2"],
            "time_entries": {"TEST-1": 300},
        }
        ctx = SessionContext.from_dict(data)

        assert ctx.session_id == "test-123"
        assert ctx.project_key == "TEST"
        assert ctx.sprint_id == 1
        assert ctx.worked_issues == ["TEST-1", "TEST-2"]
        assert ctx.time_entries == {"TEST-1": 300}


class TestSprintSummary:
    """Tests for SprintSummary dataclass."""

    def test_create_summary(self) -> None:
        """Should create sprint summary."""
        summary = SprintSummary(
            sprint_id=1,
            sprint_name="Sprint 1",
            state="active",
            total_issues=10,
            completed_issues=3,
            in_progress_issues=4,
            remaining_issues=3,
            total_points=25,
            completed_points=8,
            days_remaining=5,
        )
        assert summary.sprint_id == 1
        assert summary.total_issues == 10
        assert summary.completed_points == 8


class TestWorkItem:
    """Tests for WorkItem dataclass."""

    def test_create_work_item(self) -> None:
        """Should create work item."""
        item = WorkItem(
            key="TEST-1",
            summary="Test task",
            status="In Progress",
            priority="High",
            assignee="Test User",
            story_points=3,
            labels=["backend"],
        )
        assert item.key == "TEST-1"
        assert item.story_points == 3
        assert "backend" in item.labels


class TestSessionHooks:
    """Tests for SessionHooks."""

    @pytest.mark.asyncio
    async def test_on_session_start_basic(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should start session with basic info."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)

        result = await hooks.on_session_start(session_id="test-123")

        assert result["session_id"] == "test-123"
        assert "started_at" in result
        assert hooks.current_session is not None

    @pytest.mark.asyncio
    async def test_on_session_start_with_project(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should load work items for project."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)

        result = await hooks.on_session_start(
            session_id="test-123", project_key="TEST"
        )

        assert "work_items" in result
        assert len(result["work_items"]) == 1
        assert result["work_items"][0]["key"] == "TEST-1"

    @pytest.mark.asyncio
    async def test_on_session_start_with_board(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should load sprint info for board."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)

        result = await hooks.on_session_start(
            session_id="test-123", board_id=1
        )

        assert "sprint" in result
        assert result["sprint"]["name"] == "Sprint 1"
        assert result["sprint"]["state"] == "active"

    @pytest.mark.asyncio
    async def test_on_session_end(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should end session and return summary."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)

        # Start session first
        await hooks.on_session_start(session_id="test-123")

        # Add some work
        hooks.current_session.worked_issues = ["TEST-1"]
        hooks.current_session.time_entries = {"TEST-1": 600}

        result = await hooks.on_session_end()

        assert result["session_id"] == "test-123"
        assert "duration_seconds" in result
        assert result["worked_issues"] == ["TEST-1"]
        assert hooks.current_session is None

    @pytest.mark.asyncio
    async def test_on_session_end_no_session(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should handle end with no active session."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)

        result = await hooks.on_session_end()

        assert "error" in result

    @pytest.mark.asyncio
    async def test_on_issue_focus(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should track issue focus."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)
        await hooks.on_session_start(session_id="test-123")

        result = await hooks.on_issue_focus("TEST-1")

        assert result["key"] == "TEST-1"
        assert result["summary"] == "Test issue"
        assert "TEST-1" in hooks.current_session.worked_issues
        assert hooks.current_session.active_issue == "TEST-1"

    @pytest.mark.asyncio
    async def test_on_issue_focus_records_time(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should record time when switching issues."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)
        await hooks.on_session_start(session_id="test-123")

        # Focus on first issue
        await hooks.on_issue_focus("TEST-1")

        # Focus on second issue
        await hooks.on_issue_focus("TEST-2")

        # Should have recorded time for first issue
        assert "TEST-1" in hooks.current_session.time_entries
        assert hooks.current_session.active_issue == "TEST-2"

    @pytest.mark.asyncio
    async def test_get_session_context_active(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should return active session context."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)
        await hooks.on_session_start(
            session_id="test-123", project_key="TEST"
        )

        result = await hooks.get_session_context()

        assert result["active"] is True
        assert result["session_id"] == "test-123"
        assert result["project_key"] == "TEST"

    @pytest.mark.asyncio
    async def test_get_session_context_inactive(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should handle no active session."""
        hooks = SessionHooks(mock_client, state_file=temp_state_file)

        result = await hooks.get_session_context()

        assert result["active"] is False

    @pytest.mark.asyncio
    async def test_state_persistence(
        self, mock_client: MagicMock, temp_state_file: Path
    ) -> None:
        """Should persist and restore session state."""
        hooks1 = SessionHooks(mock_client, state_file=temp_state_file)
        await hooks1.on_session_start(
            session_id="test-123", project_key="TEST"
        )

        # Verify state file exists
        assert temp_state_file.exists()

        # Load state in new hooks instance
        hooks2 = SessionHooks(mock_client, state_file=temp_state_file)
        result = await hooks2.get_session_context()

        assert result["active"] is True
        assert result["session_id"] == "test-123"


class TestGenerateSessionGreeting:
    """Tests for generate_session_greeting."""

    def test_basic_greeting(self) -> None:
        """Should generate basic greeting."""
        context = {"session_id": "test-123", "started_at": "2025-01-01T00:00:00"}
        greeting = generate_session_greeting(context)

        assert "Session Started" in greeting

    def test_greeting_with_sprint(self) -> None:
        """Should include sprint info."""
        context = {
            "session_id": "test-123",
            "sprint": {
                "name": "Sprint 1",
                "state": "active",
                "progress": {
                    "total": 10,
                    "completed": 3,
                    "in_progress": 4,
                    "remaining": 3,
                },
                "points": {"total": 25, "completed": 8},
                "days_remaining": 5,
            },
        }
        greeting = generate_session_greeting(context)

        assert "Sprint 1" in greeting
        assert "3/10" in greeting
        assert "8/25" in greeting
        assert "5" in greeting

    def test_greeting_with_work_items(self) -> None:
        """Should include work items."""
        context = {
            "session_id": "test-123",
            "work_items": [
                {"key": "TEST-1", "summary": "Task 1", "status": "To Do"},
                {"key": "TEST-2", "summary": "Task 2", "status": "In Progress"},
            ],
        }
        greeting = generate_session_greeting(context)

        assert "TEST-1" in greeting
        assert "Task 1" in greeting
        assert "Your Work Items" in greeting


class TestGenerateSessionSummary:
    """Tests for generate_session_summary."""

    def test_basic_summary(self) -> None:
        """Should generate basic summary."""
        context = {
            "session_id": "test-123",
            "duration_seconds": 3600,
            "worked_issues": [],
            "time_entries": {},
        }
        summary = generate_session_summary(context)

        assert "Session Summary" in summary
        assert "60 minutes" in summary

    def test_summary_with_work(self) -> None:
        """Should include worked issues."""
        context = {
            "session_id": "test-123",
            "duration_seconds": 3600,
            "worked_issues": ["TEST-1", "TEST-2"],
            "time_entries": {"TEST-1": 1200, "TEST-2": 600},
        }
        summary = generate_session_summary(context)

        assert "TEST-1" in summary
        assert "TEST-2" in summary
        assert "20 minutes" in summary  # TEST-1
        assert "10 minutes" in summary  # TEST-2
