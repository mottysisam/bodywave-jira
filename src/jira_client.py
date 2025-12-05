"""
Jira REST API client for the Bodywave Jira MCP Server.

Provides typed methods for all common Jira operations including
issue CRUD, search, project management, and sprint operations.
"""

from typing import Any

import httpx
import structlog
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from src.auth import AuthProvider, OAuth2Auth, create_auth_provider
from src.config import Config
from src.exceptions import (
    APIError,
    AuthenticationError,
    AuthorizationError,
    BoardNotFoundError,
    IssueNotFoundError,
    NotFoundError,
    ProjectNotFoundError,
    RateLimitError,
    SprintNotFoundError,
    ValidationError,
)
from src.models import (
    Board,
    Issue,
    IssueCreate,
    IssueUpdate,
    Project,
    ProjectCreate,
    SearchResult,
    Sprint,
    SprintCreate,
)

logger = structlog.get_logger(__name__)


class JiraClient:
    """Async client for Jira Cloud REST API.

    Handles authentication, rate limiting, retries, and error handling.
    All methods return typed dataclass models.

    Usage:
        config = load_config()
        client = JiraClient(config)

        # Create an issue
        issue = await client.create_issue(
            project_key="BCM",
            summary="Fix bug",
            issue_type="Bug"
        )

        # Search issues
        result = await client.search_issues_jql("project = BCM")
        for issue in result.issues:
            print(issue.key, issue.summary)
    """

    # OAuth API base URL (uses cloud_id)
    OAUTH_API_BASE = "https://api.atlassian.com/ex/jira"

    def __init__(
        self,
        config: Config,
        auth_provider: AuthProvider | None = None,
    ) -> None:
        """Initialize Jira client.

        Args:
            config: Application configuration.
            auth_provider: Authentication provider. If None, creates from config.
        """
        self._config = config
        self._auth = auth_provider or create_auth_provider(
            email=config.jira_user_email,
            token=config.jira_api_token,
            oauth_client_id=config.jira_oauth_client_id,
            oauth_client_secret=config.jira_oauth_client_secret,
            oauth_redirect_uri=config.jira_oauth_redirect_uri,
        )
        self._client: httpx.AsyncClient | None = None
        self._using_oauth = isinstance(self._auth, OAuth2Auth)

    def _get_api_base_url(self) -> str:
        """Get the correct API base URL based on auth method."""
        if self._using_oauth and isinstance(self._auth, OAuth2Auth):
            cloud_id = self._auth._cloud_id
            if cloud_id:
                return f"{self.OAUTH_API_BASE}/{cloud_id}/rest/api/3"
        return self._config.api_v3_url

    def _get_agile_base_url(self) -> str:
        """Get the correct Agile API base URL based on auth method."""
        if self._using_oauth and isinstance(self._auth, OAuth2Auth):
            cloud_id = self._auth._cloud_id
            if cloud_id:
                return f"{self.OAUTH_API_BASE}/{cloud_id}/rest/agile/1.0"
        return self._config.agile_api_url

    async def __aenter__(self) -> "JiraClient":
        """Async context manager entry."""
        await self._ensure_client()
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()

    async def _ensure_client(self) -> httpx.AsyncClient:
        """Ensure HTTP client is initialized."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._config.jira_timeout),
                follow_redirects=True,
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with authentication."""
        return self._auth.get_auth_headers()

    async def _handle_response(self, response: httpx.Response) -> dict[str, Any]:
        """Handle API response and raise appropriate exceptions.

        Args:
            response: HTTP response.

        Returns:
            Parsed JSON response.

        Raises:
            Various JiraError subclasses based on status code.
        """
        if response.status_code == 204:
            return {}

        # Try to parse JSON response
        try:
            data = response.json() if response.content else {}
        except Exception:
            data = {}

        # Handle error responses
        if response.status_code == 401:
            raise AuthenticationError()
        elif response.status_code == 403:
            raise AuthorizationError()
        elif response.status_code == 404:
            message = data.get("errorMessages", ["Resource not found"])[0]
            raise NotFoundError("Resource", message)
        elif response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            raise RateLimitError(int(retry_after) if retry_after else None)
        elif response.status_code == 400:
            errors = data.get("errors", {})
            messages = data.get("errorMessages", [])
            message = "; ".join(messages) if messages else str(errors)
            raise ValidationError(message)
        elif response.status_code >= 400:
            raise APIError(
                f"API error: {response.status_code}",
                response.status_code,
                response.text,
            )

        return data

    @retry(
        retry=retry_if_exception_type(RateLimitError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60),
    )
    async def _request(
        self,
        method: str,
        endpoint: str,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        """Make an API request with retry logic.

        Args:
            method: HTTP method.
            endpoint: API endpoint (relative to base URL).
            json: JSON request body.
            params: Query parameters.
            base_url: Override base URL (for agile API).

        Returns:
            Parsed JSON response.
        """
        client = await self._ensure_client()
        await self._auth.refresh_if_needed()

        url = f"{base_url or self._get_api_base_url()}{endpoint}"
        headers = self._get_headers()

        logger.debug(
            "Making API request",
            method=method,
            url=url,
            params=params,
        )

        response = await client.request(
            method=method,
            url=url,
            headers=headers,
            json=json,
            params=params,
        )

        logger.debug(
            "Received response",
            status_code=response.status_code,
            url=url,
        )

        return await self._handle_response(response)

    # ========================================================================
    # Issue Operations
    # ========================================================================

    async def create_issue(
        self,
        project_key: str,
        summary: str,
        issue_type: str = "Task",
        description: str | None = None,
        priority: str | None = None,
        assignee_id: str | None = None,
        labels: list[str] | None = None,
        sprint_id: int | None = None,
        parent_key: str | None = None,
        story_points: float | None = None,
    ) -> Issue:
        """Create a new Jira issue.

        Args:
            project_key: Project key (e.g., "BCM").
            summary: Issue summary (required).
            issue_type: Issue type name (default: "Task").
            description: Issue description.
            priority: Priority name (e.g., "High").
            assignee_id: Atlassian account ID of assignee.
            labels: List of labels.
            sprint_id: Sprint ID to add issue to.
            parent_key: Parent issue key for subtasks.
            story_points: Story point estimate.

        Returns:
            Created Issue object.
        """
        create_request = IssueCreate(
            project_key=project_key,
            summary=summary,
            issue_type=issue_type,
            description=description,
            priority=priority,
            assignee_id=assignee_id,
            labels=labels or [],
            sprint_id=sprint_id,
            parent_key=parent_key,
            story_points=story_points,
        )

        data = await self._request("POST", "/issue", json=create_request.to_jira_payload())

        logger.info(
            "Created issue",
            key=data.get("key"),
            project=project_key,
            summary=summary,
        )

        # Fetch the full issue to return complete data
        return await self.get_issue(data["key"])

    async def get_issue(self, issue_key: str) -> Issue:
        """Get a Jira issue by key.

        Args:
            issue_key: Issue key (e.g., "BCM-123").

        Returns:
            Issue object.

        Raises:
            IssueNotFoundError: If issue doesn't exist.
        """
        try:
            data = await self._request(
                "GET",
                f"/issue/{issue_key}",
                params={
                    "expand": "names,schema",
                    "fields": "*all",
                },
            )
            return Issue.from_jira_response(data)
        except NotFoundError:
            raise IssueNotFoundError(issue_key) from None

    async def update_issue(
        self,
        issue_key: str,
        summary: str | None = None,
        description: str | None = None,
        priority: str | None = None,
        assignee_id: str | None = None,
        labels: list[str] | None = None,
        story_points: float | None = None,
    ) -> Issue:
        """Update an existing Jira issue.

        Args:
            issue_key: Issue key to update.
            summary: New summary.
            description: New description.
            priority: New priority name.
            assignee_id: New assignee account ID.
            labels: New labels (replaces existing).
            story_points: Story points.

        Returns:
            Updated Issue object.

        Raises:
            IssueNotFoundError: If issue doesn't exist.
        """
        update_request = IssueUpdate(
            summary=summary,
            description=description,
            priority=priority,
            assignee_id=assignee_id,
            labels=labels,
            status=None,
            story_points=story_points,
        )

        payload = update_request.to_jira_payload()
        if not payload["fields"]:
            # Nothing to update
            return await self.get_issue(issue_key)

        try:
            await self._request("PUT", f"/issue/{issue_key}", json=payload)
        except NotFoundError:
            raise IssueNotFoundError(issue_key) from None

        logger.info("Updated issue", key=issue_key)
        return await self.get_issue(issue_key)

    async def delete_issue(self, issue_key: str, delete_subtasks: bool = True) -> None:
        """Delete a Jira issue.

        Args:
            issue_key: Issue key to delete.
            delete_subtasks: Also delete subtasks.

        Raises:
            IssueNotFoundError: If issue doesn't exist.
        """
        try:
            await self._request(
                "DELETE",
                f"/issue/{issue_key}",
                params={"deleteSubtasks": str(delete_subtasks).lower()},
            )
            logger.info("Deleted issue", key=issue_key)
        except NotFoundError:
            raise IssueNotFoundError(issue_key) from None

    async def transition_issue(self, issue_key: str, transition_name: str) -> Issue:
        """Transition an issue to a new status.

        Args:
            issue_key: Issue key.
            transition_name: Name of the transition (e.g., "In Progress").

        Returns:
            Updated Issue object.

        Raises:
            IssueNotFoundError: If issue doesn't exist.
            ValidationError: If transition is not available.
        """
        # Get available transitions
        transitions_data = await self._request(
            "GET", f"/issue/{issue_key}/transitions"
        )
        transitions = transitions_data.get("transitions", [])

        # Find matching transition
        transition_id = None
        for t in transitions:
            if t["name"].lower() == transition_name.lower():
                transition_id = t["id"]
                break

        if not transition_id:
            available = [t["name"] for t in transitions]
            raise ValidationError(
                f"Transition '{transition_name}' not available. "
                f"Available: {available}"
            )

        # Execute transition
        await self._request(
            "POST",
            f"/issue/{issue_key}/transitions",
            json={"transition": {"id": transition_id}},
        )

        logger.info("Transitioned issue", key=issue_key, transition=transition_name)
        return await self.get_issue(issue_key)

    async def add_comment(self, issue_key: str, body: str) -> None:
        """Add a comment to an issue.

        Args:
            issue_key: Issue key.
            body: Comment body text.
        """
        await self._request(
            "POST",
            f"/issue/{issue_key}/comment",
            json={
                "body": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": body}],
                        }
                    ],
                }
            },
        )
        logger.info("Added comment", issue_key=issue_key)

    # ========================================================================
    # Search Operations
    # ========================================================================

    async def search_issues_jql(
        self,
        jql: str,
        max_results: int = 50,
        start_at: int = 0,
        fields: list[str] | None = None,
    ) -> SearchResult:
        """Search for issues using JQL.

        Args:
            jql: JQL query string.
            max_results: Maximum results per page (default 50).
            start_at: Starting index for pagination.
            fields: Specific fields to return.

        Returns:
            SearchResult with issues and pagination info.
        """
        params: dict[str, Any] = {
            "jql": jql,
            "maxResults": max_results,
            "startAt": start_at,
        }
        if fields:
            params["fields"] = ",".join(fields)

        data = await self._request("GET", "/search/jql", params=params)

        issues = [Issue.from_jira_response(i) for i in data.get("issues", [])]

        return SearchResult(
            issues=issues,
            total=data.get("total", 0),
            start_at=data.get("startAt", 0),
            max_results=data.get("maxResults", max_results),
        )

    async def search_all_issues_jql(
        self,
        jql: str,
        fields: list[str] | None = None,
    ) -> list[Issue]:
        """Search for all issues matching JQL (handles pagination).

        Args:
            jql: JQL query string.
            fields: Specific fields to return.

        Returns:
            List of all matching issues.
        """
        all_issues: list[Issue] = []
        start_at = 0
        page_size = 100

        while True:
            result = await self.search_issues_jql(
                jql=jql,
                max_results=page_size,
                start_at=start_at,
                fields=fields,
            )
            all_issues.extend(result.issues)

            if not result.has_more:
                break

            start_at += len(result.issues)

        return all_issues

    # ========================================================================
    # Project Operations
    # ========================================================================

    async def get_project(self, project_key: str) -> Project:
        """Get project details.

        Args:
            project_key: Project key.

        Returns:
            Project object.

        Raises:
            ProjectNotFoundError: If project doesn't exist.
        """
        try:
            data = await self._request(
                "GET",
                f"/project/{project_key}",
                params={"expand": "description,lead"},
            )
            return Project.from_jira_response(data)
        except NotFoundError:
            raise ProjectNotFoundError(project_key) from None

    async def list_projects(self) -> list[Project]:
        """List all accessible projects.

        Returns:
            List of Project objects.
        """
        data = await self._request(
            "GET",
            "/project/search",
            params={"expand": "description,lead"},
        )
        return [Project.from_jira_response(p) for p in data.get("values", [])]

    async def create_project(
        self,
        key: str,
        name: str,
        project_type: str = "software",
        description: str | None = None,
        lead_account_id: str | None = None,
        template_key: str | None = None,
    ) -> Project:
        """Create a new project.

        Args:
            key: Project key (2-10 uppercase chars).
            name: Project name.
            project_type: Project type (software, business, service_desk). Defaults to software.
            description: Project description.
            lead_account_id: Project lead account ID. If None, uses current user.
            template_key: Project template key.

        Returns:
            Created Project object.

        Raises:
            ValidationError: If project key is invalid.
            APIError: If project creation fails.
        """
        project = ProjectCreate(
            key=key,
            name=name,
            project_type=project_type,
            description=description,
            lead_account_id=lead_account_id,
            template_key=template_key,
        )

        response = await self._request(
            "POST",
            "/project",
            json=project.to_jira_payload(),
        )

        # POST response doesn't include all project details
        # Fetch the created project to return full data
        project_key = response.get("key") or key
        return await self.get_project(project_key)

    # ========================================================================
    # Board Operations (Agile API)
    # ========================================================================

    async def get_board(self, board_id: int) -> Board:
        """Get board details.

        Args:
            board_id: Board ID.

        Returns:
            Board object.

        Raises:
            BoardNotFoundError: If board doesn't exist.
        """
        try:
            data = await self._request(
                "GET",
                f"/board/{board_id}",
                base_url=self._get_agile_base_url(),
            )
            return Board.from_jira_response(data)
        except NotFoundError:
            raise BoardNotFoundError(board_id) from None

    async def list_boards(self, project_key: str | None = None) -> list[Board]:
        """List boards, optionally filtered by project.

        Args:
            project_key: Optional project key filter.

        Returns:
            List of Board objects.
        """
        params = {}
        if project_key:
            params["projectKeyOrId"] = project_key

        data = await self._request(
            "GET",
            "/board",
            params=params,
            base_url=self._get_agile_base_url(),
        )
        return [Board.from_jira_response(b) for b in data.get("values", [])]

    # ========================================================================
    # Sprint Operations (Agile API)
    # ========================================================================

    async def get_sprint(self, sprint_id: int) -> Sprint:
        """Get sprint details.

        Args:
            sprint_id: Sprint ID.

        Returns:
            Sprint object.

        Raises:
            SprintNotFoundError: If sprint doesn't exist.
        """
        try:
            data = await self._request(
                "GET",
                f"/sprint/{sprint_id}",
                base_url=self._get_agile_base_url(),
            )
            return Sprint.from_jira_response(data)
        except NotFoundError:
            raise SprintNotFoundError(sprint_id) from None

    async def list_sprints(
        self,
        board_id: int,
        state: str | None = None,
    ) -> list[Sprint]:
        """List sprints for a board.

        Args:
            board_id: Board ID.
            state: Filter by state (future, active, closed).

        Returns:
            List of Sprint objects.
        """
        params = {}
        if state:
            params["state"] = state

        data = await self._request(
            "GET",
            f"/board/{board_id}/sprint",
            params=params,
            base_url=self._get_agile_base_url(),
        )
        return [Sprint.from_jira_response(s) for s in data.get("values", [])]

    async def create_sprint(
        self,
        board_id: int,
        name: str,
        start_date: str | None = None,
        end_date: str | None = None,
        goal: str | None = None,
    ) -> Sprint:
        """Create a new sprint.

        Args:
            board_id: Board ID to create sprint on.
            name: Sprint name.
            start_date: Start date (ISO format).
            end_date: End date (ISO format).
            goal: Sprint goal.

        Returns:
            Created Sprint object.
        """
        from datetime import date as date_type

        create_request = SprintCreate(
            name=name,
            board_id=board_id,
            start_date=date_type.fromisoformat(start_date) if start_date else None,
            end_date=date_type.fromisoformat(end_date) if end_date else None,
            goal=goal,
        )

        data = await self._request(
            "POST",
            "/sprint",
            json=create_request.to_jira_payload(),
            base_url=self._get_agile_base_url(),
        )

        logger.info("Created sprint", id=data.get("id"), name=name)
        return Sprint.from_jira_response(data)

    async def start_sprint(
        self,
        sprint_id: int,
        start_date: str,
        end_date: str,
        goal: str | None = None,
    ) -> Sprint:
        """Start a sprint.

        Args:
            sprint_id: Sprint ID.
            start_date: Start date (ISO format).
            end_date: End date (ISO format).
            goal: Sprint goal.

        Returns:
            Updated Sprint object.
        """
        payload: dict[str, Any] = {
            "state": "active",
            "startDate": start_date,
            "endDate": end_date,
        }
        if goal:
            payload["goal"] = goal

        data = await self._request(
            "POST",
            f"/sprint/{sprint_id}",
            json=payload,
            base_url=self._get_agile_base_url(),
        )

        logger.info("Started sprint", id=sprint_id)
        return Sprint.from_jira_response(data)

    async def close_sprint(self, sprint_id: int) -> Sprint:
        """Close a sprint.

        Args:
            sprint_id: Sprint ID.

        Returns:
            Updated Sprint object.
        """
        data = await self._request(
            "POST",
            f"/sprint/{sprint_id}",
            json={"state": "closed"},
            base_url=self._get_agile_base_url(),
        )

        logger.info("Closed sprint", id=sprint_id)
        return Sprint.from_jira_response(data)

    async def add_issues_to_sprint(
        self,
        sprint_id: int,
        issue_keys: list[str],
    ) -> None:
        """Add issues to a sprint.

        Args:
            sprint_id: Sprint ID.
            issue_keys: List of issue keys to add.
        """
        await self._request(
            "POST",
            f"/sprint/{sprint_id}/issue",
            json={"issues": issue_keys},
            base_url=self._get_agile_base_url(),
        )

        logger.info(
            "Added issues to sprint",
            sprint_id=sprint_id,
            count=len(issue_keys),
        )

    async def remove_issues_from_sprint(
        self,
        issue_keys: list[str],
    ) -> None:
        """Remove issues from their current sprint (move to backlog).

        Args:
            issue_keys: List of issue keys to remove.
        """
        await self._request(
            "POST",
            "/backlog/issue",
            json={"issues": issue_keys},
            base_url=self._get_agile_base_url(),
        )

        logger.info("Moved issues to backlog", count=len(issue_keys))

    # ========================================================================
    # User Operations
    # ========================================================================

    async def get_myself(self) -> dict[str, Any]:
        """Get current user info (useful for verifying auth).

        Returns:
            User data dictionary.
        """
        return await self._request("GET", "/myself")

    async def search_users(self, query: str, max_results: int = 50) -> list[dict[str, Any]]:
        """Search for users.

        Args:
            query: Search query (name or email).
            max_results: Maximum results.

        Returns:
            List of user data dictionaries.
        """
        data = await self._request(
            "GET",
            "/user/search",
            params={"query": query, "maxResults": max_results},
        )
        return data if isinstance(data, list) else []

    # ========================================================================
    # Utility Methods
    # ========================================================================

    async def verify_connection(self) -> bool:
        """Verify the Jira connection is working.

        Returns:
            True if connection is valid.

        Raises:
            AuthenticationError: If credentials are invalid.
        """
        try:
            await self.get_myself()
            return True
        except Exception as e:
            logger.error("Connection verification failed", error=str(e))
            raise
