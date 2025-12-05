"""
Tests for JiraClient.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.config import Config
from src.exceptions import (
    AuthenticationError,
    IssueNotFoundError,
    RateLimitError,
    ValidationError,
)
from src.jira_client import JiraClient
from src.models import Issue, Project


class TestJiraClientInit:
    """Tests for JiraClient initialization."""

    def test_init_with_config(self, mock_config: Config) -> None:
        """Test initializing client with config."""
        client = JiraClient(mock_config)
        assert client._config == mock_config


class TestJiraClientResponses:
    """Tests for response handling."""

    @pytest.mark.asyncio
    async def test_handle_401_response(self, mock_config: Config) -> None:
        """Test handling 401 Unauthorized."""
        client = JiraClient(mock_config)

        response = httpx.Response(401, json={"message": "Unauthorized"})

        with pytest.raises(AuthenticationError):
            await client._handle_response(response)

    @pytest.mark.asyncio
    async def test_handle_429_response(self, mock_config: Config) -> None:
        """Test handling 429 Rate Limited."""
        client = JiraClient(mock_config)

        response = httpx.Response(
            429,
            json={},
            headers={"Retry-After": "60"},
        )

        with pytest.raises(RateLimitError) as exc_info:
            await client._handle_response(response)

        assert exc_info.value.retry_after == 60

    @pytest.mark.asyncio
    async def test_handle_400_response(self, mock_config: Config) -> None:
        """Test handling 400 Bad Request."""
        client = JiraClient(mock_config)

        response = httpx.Response(
            400,
            json={"errorMessages": ["Summary is required"]},
        )

        with pytest.raises(ValidationError) as exc_info:
            await client._handle_response(response)

        assert "Summary is required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_handle_204_response(self, mock_config: Config) -> None:
        """Test handling 204 No Content."""
        client = JiraClient(mock_config)

        response = httpx.Response(204)
        result = await client._handle_response(response)

        assert result == {}


class TestJiraClientIssueOperations:
    """Tests for issue operations."""

    @pytest.mark.asyncio
    async def test_create_issue(
        self,
        mock_config: Config,
        sample_issue_response: dict[str, Any],
    ) -> None:
        """Test creating an issue."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            # First call returns created issue ID
            mock_request.side_effect = [
                {"id": "10001", "key": "TEST-123"},
                sample_issue_response,  # Second call gets full issue
            ]

            issue = await client.create_issue(
                project_key="TEST",
                summary="Test Issue",
                issue_type="Task",
            )

            assert issue.key == "TEST-123"
            assert mock_request.call_count == 2

    @pytest.mark.asyncio
    async def test_get_issue(
        self,
        mock_config: Config,
        sample_issue_response: dict[str, Any],
    ) -> None:
        """Test getting an issue."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = sample_issue_response

            issue = await client.get_issue("TEST-123")

            assert issue.key == "TEST-123"
            assert issue.summary == "Test Issue"
            mock_request.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_issue_not_found(self, mock_config: Config) -> None:
        """Test getting non-existent issue."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            from src.exceptions import NotFoundError

            mock_request.side_effect = NotFoundError("Issue", "TEST-999")

            with pytest.raises(IssueNotFoundError):
                await client.get_issue("TEST-999")

    @pytest.mark.asyncio
    async def test_update_issue(
        self,
        mock_config: Config,
        sample_issue_response: dict[str, Any],
    ) -> None:
        """Test updating an issue."""
        client = JiraClient(mock_config)

        # Modify response to show updated summary
        updated_response = sample_issue_response.copy()
        updated_response["fields"] = sample_issue_response["fields"].copy()
        updated_response["fields"]["summary"] = "Updated Summary"

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = [
                {},  # PUT returns empty
                updated_response,  # GET returns updated
            ]

            issue = await client.update_issue(
                issue_key="TEST-123",
                summary="Updated Summary",
            )

            assert issue.summary == "Updated Summary"

    @pytest.mark.asyncio
    async def test_delete_issue(self, mock_config: Config) -> None:
        """Test deleting an issue."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = {}

            await client.delete_issue("TEST-123")

            mock_request.assert_called_once()
            call_args = mock_request.call_args
            assert call_args[0][0] == "DELETE"
            assert "TEST-123" in call_args[0][1]


class TestJiraClientSearchOperations:
    """Tests for search operations."""

    @pytest.mark.asyncio
    async def test_search_issues_jql(
        self,
        mock_config: Config,
        sample_search_response: dict[str, Any],
    ) -> None:
        """Test searching issues with JQL."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = sample_search_response

            result = await client.search_issues_jql("project = TEST")

            assert len(result.issues) == 1
            assert result.total == 1
            assert result.issues[0].key == "TEST-123"

    @pytest.mark.asyncio
    async def test_search_all_issues_jql_pagination(
        self,
        mock_config: Config,
        sample_issue_response: dict[str, Any],
    ) -> None:
        """Test searching all issues handles pagination."""
        client = JiraClient(mock_config)

        # Create responses for pagination
        page1 = {
            "startAt": 0,
            "maxResults": 1,
            "total": 2,
            "issues": [sample_issue_response],
        }

        # Create a different issue for page 2
        issue2 = sample_issue_response.copy()
        issue2["key"] = "TEST-124"
        page2 = {
            "startAt": 1,
            "maxResults": 1,
            "total": 2,
            "issues": [issue2],
        }

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = [page1, page2]

            issues = await client.search_all_issues_jql("project = TEST")

            assert len(issues) == 2


class TestJiraClientProjectOperations:
    """Tests for project operations."""

    @pytest.mark.asyncio
    async def test_get_project(
        self,
        mock_config: Config,
        sample_project_response: dict[str, Any],
    ) -> None:
        """Test getting project details."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = sample_project_response

            project = await client.get_project("TEST")

            assert project.key == "TEST"
            assert project.name == "Test Project"

    @pytest.mark.asyncio
    async def test_list_projects(
        self,
        mock_config: Config,
        sample_project_response: dict[str, Any],
    ) -> None:
        """Test listing projects."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = {"values": [sample_project_response]}

            projects = await client.list_projects()

            assert len(projects) == 1
            assert projects[0].key == "TEST"


class TestJiraClientSprintOperations:
    """Tests for sprint operations."""

    @pytest.mark.asyncio
    async def test_list_sprints(
        self,
        mock_config: Config,
        sample_sprint_response: dict[str, Any],
    ) -> None:
        """Test listing sprints."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = {"values": [sample_sprint_response]}

            sprints = await client.list_sprints(board_id=1)

            assert len(sprints) == 1
            assert sprints[0].name == "TEST-Sprint-PI2025Q1-1"

    @pytest.mark.asyncio
    async def test_create_sprint(
        self,
        mock_config: Config,
        sample_sprint_response: dict[str, Any],
    ) -> None:
        """Test creating a sprint."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = sample_sprint_response

            sprint = await client.create_sprint(
                board_id=1,
                name="New Sprint",
                start_date="2025-01-01",
                end_date="2025-01-14",
            )

            assert sprint.id == 1


class TestJiraClientVerification:
    """Tests for connection verification."""

    @pytest.mark.asyncio
    async def test_verify_connection(
        self,
        mock_config: Config,
        sample_myself_response: dict[str, Any],
    ) -> None:
        """Test verifying connection."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = sample_myself_response

            result = await client.verify_connection()

            assert result is True

    @pytest.mark.asyncio
    async def test_verify_connection_failure(self, mock_config: Config) -> None:
        """Test verification failure."""
        client = JiraClient(mock_config)

        with patch.object(client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = AuthenticationError()

            with pytest.raises(AuthenticationError):
                await client.verify_connection()
