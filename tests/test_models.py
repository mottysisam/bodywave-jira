"""
Tests for data models.
"""

from datetime import date, datetime
from typing import Any

import pytest

from src.models import (
    Board,
    Issue,
    IssueCreate,
    IssueUpdate,
    ProgramIncrement,
    Project,
    SearchResult,
    Sprint,
    SprintCreate,
    SprintState,
    User,
)


class TestUser:
    """Tests for User model."""

    def test_from_jira_response(self) -> None:
        """Test creating User from API response."""
        data = {
            "accountId": "123",
            "displayName": "Test User",
            "emailAddress": "test@test.com",
            "active": True,
            "avatarUrls": {"48x48": "https://avatar.url"},
        }
        user = User.from_jira_response(data)

        assert user.account_id == "123"
        assert user.display_name == "Test User"
        assert user.email_address == "test@test.com"
        assert user.active is True
        assert user.avatar_url == "https://avatar.url"

    def test_from_jira_response_minimal(self) -> None:
        """Test creating User with minimal data."""
        data = {"accountId": "123"}
        user = User.from_jira_response(data)

        assert user.account_id == "123"
        assert user.display_name == "Unknown"
        assert user.email_address is None


class TestIssue:
    """Tests for Issue model."""

    def test_from_jira_response(self, sample_issue_response: dict[str, Any]) -> None:
        """Test creating Issue from API response."""
        issue = Issue.from_jira_response(sample_issue_response)

        assert issue.id == "10001"
        assert issue.key == "TEST-123"
        assert issue.summary == "Test Issue"
        assert issue.issue_type == "Task"
        assert issue.status == "To Do"
        assert issue.priority == "Medium"
        assert issue.project_key == "TEST"
        assert issue.assignee is not None
        assert issue.assignee.display_name == "Test User"
        assert issue.reporter is not None
        assert issue.labels == ["test", "demo"]

    def test_from_jira_response_no_assignee(self) -> None:
        """Test creating Issue without assignee."""
        data = {
            "id": "10001",
            "key": "TEST-1",
            "fields": {
                "summary": "No Assignee",
                "issuetype": {"name": "Task"},
                "status": {"name": "To Do"},
                "project": {"key": "TEST"},
                "assignee": None,
                "reporter": None,
                "labels": [],
                "created": "2025-01-01T10:00:00.000+0000",
                "updated": "2025-01-01T10:00:00.000+0000",
            },
        }
        issue = Issue.from_jira_response(data)

        assert issue.assignee is None
        assert issue.reporter is None


class TestIssueCreate:
    """Tests for IssueCreate model."""

    def test_to_jira_payload_minimal(self) -> None:
        """Test creating minimal Jira payload."""
        create = IssueCreate(
            project_key="TEST",
            summary="New Issue",
        )
        payload = create.to_jira_payload()

        assert payload["fields"]["project"]["key"] == "TEST"
        assert payload["fields"]["summary"] == "New Issue"
        assert payload["fields"]["issuetype"]["name"] == "Task"

    def test_to_jira_payload_full(self) -> None:
        """Test creating full Jira payload."""
        create = IssueCreate(
            project_key="TEST",
            summary="Full Issue",
            description="Description",
            issue_type="Bug",
            priority="High",
            assignee_id="user123",
            labels=["bug", "critical"],
        )
        payload = create.to_jira_payload()

        assert payload["fields"]["project"]["key"] == "TEST"
        assert payload["fields"]["summary"] == "Full Issue"
        assert payload["fields"]["issuetype"]["name"] == "Bug"
        assert payload["fields"]["priority"]["name"] == "High"
        assert payload["fields"]["assignee"]["accountId"] == "user123"
        assert payload["fields"]["labels"] == ["bug", "critical"]
        # Check ADF description format
        assert payload["fields"]["description"]["type"] == "doc"


class TestIssueUpdate:
    """Tests for IssueUpdate model."""

    def test_to_jira_payload_partial(self) -> None:
        """Test creating partial update payload."""
        update = IssueUpdate(summary="Updated Summary")
        payload = update.to_jira_payload()

        assert payload["fields"]["summary"] == "Updated Summary"
        assert "description" not in payload["fields"]
        assert "priority" not in payload["fields"]

    def test_to_jira_payload_empty(self) -> None:
        """Test creating empty update payload."""
        update = IssueUpdate()
        payload = update.to_jira_payload()

        assert payload["fields"] == {}


class TestProject:
    """Tests for Project model."""

    def test_from_jira_response(self, sample_project_response: dict[str, Any]) -> None:
        """Test creating Project from API response."""
        project = Project.from_jira_response(sample_project_response)

        assert project.id == "10000"
        assert project.key == "TEST"
        assert project.name == "Test Project"
        assert project.lead is not None
        assert project.lead.display_name == "Project Lead"


class TestSprint:
    """Tests for Sprint model."""

    def test_from_jira_response(self, sample_sprint_response: dict[str, Any]) -> None:
        """Test creating Sprint from API response."""
        sprint = Sprint.from_jira_response(sample_sprint_response)

        assert sprint.id == 1
        assert sprint.name == "TEST-Sprint-PI2025Q1-1"
        assert sprint.state == SprintState.ACTIVE
        assert sprint.start_date == date(2025, 1, 1)
        assert sprint.end_date == date(2025, 1, 14)
        assert sprint.board_id == 1
        assert sprint.goal == "Sprint 1 goals"

    def test_from_jira_response_future(self) -> None:
        """Test creating future Sprint."""
        data = {
            "id": 2,
            "name": "Future Sprint",
            "state": "future",
            "originBoardId": 1,
        }
        sprint = Sprint.from_jira_response(data)

        assert sprint.state == SprintState.FUTURE
        assert sprint.start_date is None
        assert sprint.end_date is None


class TestSprintCreate:
    """Tests for SprintCreate model."""

    def test_to_jira_payload(self) -> None:
        """Test creating Jira payload."""
        create = SprintCreate(
            name="New Sprint",
            board_id=1,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 1, 14),
            goal="Sprint goal",
        )
        payload = create.to_jira_payload()

        assert payload["name"] == "New Sprint"
        assert payload["originBoardId"] == 1
        assert payload["startDate"] == "2025-01-01"
        assert payload["endDate"] == "2025-01-14"
        assert payload["goal"] == "Sprint goal"


class TestBoard:
    """Tests for Board model."""

    def test_from_jira_response(self, sample_board_response: dict[str, Any]) -> None:
        """Test creating Board from API response."""
        board = Board.from_jira_response(sample_board_response)

        assert board.id == 1
        assert board.name == "TEST Board"
        assert board.board_type == "scrum"
        assert board.project_key == "TEST"


class TestProgramIncrement:
    """Tests for ProgramIncrement model."""

    def test_is_current(self) -> None:
        """Test is_current property."""
        # Create a PI that includes today
        today = date.today()
        pi = ProgramIncrement(
            name="Current PI",
            year=today.year,
            quarter=(today.month - 1) // 3 + 1,
            start_date=date(today.year, 1, 1),
            end_date=date(today.year, 12, 31),
        )
        assert pi.is_current is True

    def test_label(self) -> None:
        """Test label property."""
        pi = ProgramIncrement(
            name="PI-2025-Q1",
            year=2025,
            quarter=1,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 3, 31),
        )
        assert pi.label == "PI-2025-Q1"


class TestSearchResult:
    """Tests for SearchResult model."""

    def test_has_more_true(self, sample_issue: Issue) -> None:
        """Test has_more when more results exist."""
        result = SearchResult(
            issues=[sample_issue],
            total=100,
            start_at=0,
            max_results=50,
        )
        assert result.has_more is True

    def test_has_more_false(self, sample_issue: Issue) -> None:
        """Test has_more when no more results."""
        result = SearchResult(
            issues=[sample_issue],
            total=1,
            start_at=0,
            max_results=50,
        )
        assert result.has_more is False
