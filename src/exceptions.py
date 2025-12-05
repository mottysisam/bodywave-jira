"""
Custom exceptions for the Bodywave Jira MCP Server.

All exceptions inherit from JiraError for easy catching.
"""


class JiraError(Exception):
    """Base exception for all Jira-related errors."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code

    def __str__(self) -> str:
        if self.status_code:
            return f"[{self.status_code}] {self.message}"
        return self.message


class AuthenticationError(JiraError):
    """Raised when authentication fails."""

    def __init__(self, message: str = "Authentication failed") -> None:
        super().__init__(message, status_code=401)


class AuthorizationError(JiraError):
    """Raised when the user lacks permission."""

    def __init__(self, message: str = "Insufficient permissions") -> None:
        super().__init__(message, status_code=403)


class NotFoundError(JiraError):
    """Raised when a resource is not found."""

    def __init__(self, resource_type: str, identifier: str) -> None:
        super().__init__(f"{resource_type} '{identifier}' not found", status_code=404)
        self.resource_type = resource_type
        self.identifier = identifier


class RateLimitError(JiraError):
    """Raised when rate limit is exceeded."""

    def __init__(self, retry_after: int | None = None) -> None:
        message = "Rate limit exceeded"
        if retry_after:
            message += f", retry after {retry_after} seconds"
        super().__init__(message, status_code=429)
        self.retry_after = retry_after


class ValidationError(JiraError):
    """Raised when input validation fails."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message, status_code=400)
        self.field = field


class ConfigurationError(JiraError):
    """Raised when configuration is invalid or missing."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ProjectNotFoundError(NotFoundError):
    """Raised when a Jira project is not found."""

    def __init__(self, project_key: str) -> None:
        super().__init__("Project", project_key)


class IssueNotFoundError(NotFoundError):
    """Raised when a Jira issue is not found."""

    def __init__(self, issue_key: str) -> None:
        super().__init__("Issue", issue_key)


class SprintNotFoundError(NotFoundError):
    """Raised when a sprint is not found."""

    def __init__(self, sprint_id: int | str) -> None:
        super().__init__("Sprint", str(sprint_id))


class BoardNotFoundError(NotFoundError):
    """Raised when a board is not found."""

    def __init__(self, board_id: int | str) -> None:
        super().__init__("Board", str(board_id))


class APIError(JiraError):
    """Raised for general API errors."""

    def __init__(
        self,
        message: str,
        status_code: int,
        response_body: str | None = None,
    ) -> None:
        super().__init__(message, status_code)
        self.response_body = response_body
