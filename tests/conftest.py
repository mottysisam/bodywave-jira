"""
Pytest configuration and fixtures for Bodywave Jira MCP Server tests.
"""

import json
from datetime import date
from typing import Any, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import Config, ProjectsConfig
from src.models import Issue, Project, Sprint, SprintState


@pytest.fixture
def mock_config() -> Config:
    """Create a mock configuration."""
    with patch.dict(
        "os.environ",
        {
            "JIRA_BASE_URL": "https://test.atlassian.net",
            "JIRA_USER_EMAIL": "test@test.com",
            "JIRA_API_TOKEN": "test-token",
        },
    ):
        return Config()  # type: ignore[call-arg]


@pytest.fixture
def mock_projects_config() -> ProjectsConfig:
    """Create a mock projects configuration."""
    data = {
        "version": "1.0.0",
        "organization": {
            "name": "Test Org",
            "jira_domain": "test.atlassian.net",
        },
        "agile": {
            "pi_duration_months": 3,
            "pis_per_year": 4,
            "pi_naming_pattern": "PI-{year}-Q{quarter}",
            "sprint_naming_pattern": "{project}-Sprint-{pi}-{number}",
            "default_sprint_duration_weeks": 2,
            "default_sprints_per_pi": 6,
        },
        "projects": [
            {
                "key": "TEST",
                "name": "Test Project",
                "description": "Test project for unit tests",
                "board_id": 1,
                "sprint_duration_weeks": 2,
                "sprints_per_pi": 6,
                "default_issue_type": "Task",
            },
            {
                "key": "BCM",
                "name": "BCM Cloud",
                "description": "Healthcare SaaS",
                "board_id": 2,
                "sprint_duration_weeks": 2,
                "sprints_per_pi": 6,
                "default_issue_type": "Task",
            },
        ],
        "issue_types": {
            "epic": "Epic",
            "story": "Story",
            "task": "Task",
            "bug": "Bug",
        },
        "priorities": {
            "high": "High",
            "medium": "Medium",
            "low": "Low",
        },
    }
    return ProjectsConfig(data)


@pytest.fixture
def sample_issue_response() -> dict[str, Any]:
    """Sample Jira issue API response."""
    return {
        "id": "10001",
        "key": "TEST-123",
        "fields": {
            "summary": "Test Issue",
            "description": "Test description",
            "issuetype": {"name": "Task"},
            "status": {"name": "To Do"},
            "priority": {"name": "Medium"},
            "project": {"key": "TEST"},
            "assignee": {
                "accountId": "user123",
                "displayName": "Test User",
                "emailAddress": "test@test.com",
                "active": True,
            },
            "reporter": {
                "accountId": "user456",
                "displayName": "Reporter User",
                "emailAddress": "reporter@test.com",
                "active": True,
            },
            "labels": ["test", "demo"],
            "created": "2025-01-01T10:00:00.000+0000",
            "updated": "2025-01-02T10:00:00.000+0000",
        },
    }


@pytest.fixture
def sample_issue(sample_issue_response: dict[str, Any]) -> Issue:
    """Sample Issue object."""
    return Issue.from_jira_response(sample_issue_response)


@pytest.fixture
def sample_project_response() -> dict[str, Any]:
    """Sample Jira project API response."""
    return {
        "id": "10000",
        "key": "TEST",
        "name": "Test Project",
        "description": "Test project description",
        "projectTypeKey": "software",
        "style": "next-gen",
        "lead": {
            "accountId": "lead123",
            "displayName": "Project Lead",
            "emailAddress": "lead@test.com",
            "active": True,
        },
    }


@pytest.fixture
def sample_project(sample_project_response: dict[str, Any]) -> Project:
    """Sample Project object."""
    return Project.from_jira_response(sample_project_response)


@pytest.fixture
def sample_sprint_response() -> dict[str, Any]:
    """Sample Jira sprint API response."""
    return {
        "id": 1,
        "name": "TEST-Sprint-PI2025Q1-1",
        "state": "active",
        "startDate": "2025-01-01",
        "endDate": "2025-01-14",
        "originBoardId": 1,
        "goal": "Sprint 1 goals",
    }


@pytest.fixture
def sample_sprint(sample_sprint_response: dict[str, Any]) -> Sprint:
    """Sample Sprint object."""
    return Sprint.from_jira_response(sample_sprint_response)


@pytest.fixture
def mock_httpx_client() -> Generator[AsyncMock, None, None]:
    """Mock httpx.AsyncClient for API tests."""
    with patch("httpx.AsyncClient") as mock:
        client_instance = AsyncMock()
        mock.return_value.__aenter__.return_value = client_instance
        mock.return_value.__aexit__.return_value = None
        yield client_instance


@pytest.fixture
def sample_search_response(sample_issue_response: dict[str, Any]) -> dict[str, Any]:
    """Sample Jira search API response."""
    return {
        "expand": "names,schema",
        "startAt": 0,
        "maxResults": 50,
        "total": 1,
        "issues": [sample_issue_response],
    }


@pytest.fixture
def sample_board_response() -> dict[str, Any]:
    """Sample Jira board API response."""
    return {
        "id": 1,
        "name": "TEST Board",
        "type": "scrum",
        "location": {
            "projectKey": "TEST",
        },
    }


@pytest.fixture
def sample_myself_response() -> dict[str, Any]:
    """Sample Jira myself API response."""
    return {
        "accountId": "user123",
        "displayName": "Current User",
        "emailAddress": "user@test.com",
        "active": True,
    }
