"""
Authentication providers for the Bodywave Jira MCP Server.

Supports API Token authentication (current) and OAuth 2.0 (future).
The design uses an abstract AuthProvider to enable easy migration.
"""

import base64
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx

from src.exceptions import AuthenticationError, ConfigurationError


class AuthProvider(ABC):
    """Abstract base class for authentication providers.

    Implement this interface to add new authentication methods.
    The JiraClient accepts any AuthProvider implementation.
    """

    @abstractmethod
    def get_auth_headers(self) -> dict[str, str]:
        """Get authentication headers for API requests.

        Returns:
            Dictionary of headers to include in requests.
        """
        ...

    @abstractmethod
    async def refresh_if_needed(self) -> None:
        """Refresh credentials if they are about to expire.

        For API tokens, this is a no-op.
        For OAuth, this handles token refresh.
        """
        ...

    @property
    @abstractmethod
    def is_valid(self) -> bool:
        """Check if credentials are still valid."""
        ...


class APITokenAuth(AuthProvider):
    """Authentication using Atlassian API Token.

    This is the recommended method for automation as of late 2025.
    API tokens are generated at: https://id.atlassian.com/manage-profile/security/api-tokens

    Usage:
        auth = APITokenAuth(email="user@example.com", token="your-api-token")
        headers = auth.get_auth_headers()
        # headers = {"Authorization": "Basic base64(email:token)"}
    """

    def __init__(self, email: str, token: str) -> None:
        """Initialize API token authentication.

        Args:
            email: Atlassian account email address.
            token: API token from Atlassian account settings.
        """
        if not email or not token:
            raise ConfigurationError("Email and API token are required")

        self._email = email
        self._token = token
        self._auth_string = self._create_auth_string()

    def _create_auth_string(self) -> str:
        """Create Base64-encoded auth string."""
        credentials = f"{self._email}:{self._token}"
        return base64.b64encode(credentials.encode()).decode()

    def get_auth_headers(self) -> dict[str, str]:
        """Get Basic auth headers.

        Returns:
            Headers with Basic authentication.
        """
        return {
            "Authorization": f"Basic {self._auth_string}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def refresh_if_needed(self) -> None:
        """No-op for API tokens (they don't expire automatically)."""
        pass

    @property
    def is_valid(self) -> bool:
        """API tokens are valid until revoked."""
        return bool(self._token)


@dataclass
class OAuth2Token:
    """OAuth 2.0 token container."""

    access_token: str
    refresh_token: str
    expires_at: datetime
    token_type: str = "Bearer"
    scope: str = ""

    @property
    def is_expired(self) -> bool:
        """Check if token is expired (with 5 min buffer)."""
        return datetime.now() >= (self.expires_at - timedelta(minutes=5))

    @classmethod
    def from_response(cls, data: dict[str, Any]) -> "OAuth2Token":
        """Create token from OAuth response."""
        expires_in = data.get("expires_in", 3600)
        return cls(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", ""),
            expires_at=datetime.now() + timedelta(seconds=expires_in),
            token_type=data.get("token_type", "Bearer"),
            scope=data.get("scope", ""),
        )


class OAuth2Auth(AuthProvider):
    """OAuth 2.0 (3LO) authentication for Jira Cloud.

    NOTE: This is a placeholder implementation for future migration.
    As of late 2025, API tokens are still the recommended method for automation,
    but OAuth 2.0 provides more granular permissions and is preferred for
    interactive applications.

    The 3LO (3-Legged OAuth) flow:
    1. User is redirected to Atlassian to authorize the app
    2. Atlassian redirects back with an authorization code
    3. App exchanges the code for access and refresh tokens
    4. App uses access token for API calls
    5. App refreshes token when it expires

    Setup steps (when ready to implement):
    1. Create an OAuth 2.0 app at https://developer.atlassian.com/console/myapps/
    2. Configure redirect URI
    3. Get client_id and client_secret
    4. Implement the authorization flow

    Resources:
    - https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
    - https://developer.atlassian.com/cloud/jira/platform/oauth-2-authorization-code-grants/
    """

    # Atlassian OAuth endpoints
    AUTH_URL = "https://auth.atlassian.com/authorize"
    TOKEN_URL = "https://auth.atlassian.com/oauth/token"
    RESOURCE_URL = "https://api.atlassian.com/oauth/token/accessible-resources"

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        token: OAuth2Token | None = None,
    ) -> None:
        """Initialize OAuth 2.0 authentication.

        Args:
            client_id: OAuth app client ID.
            client_secret: OAuth app client secret.
            redirect_uri: Configured redirect URI.
            token: Existing OAuth token (if already authorized).
        """
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._token = token
        self._cloud_id: str | None = None

    def get_authorization_url(self, state: str, scopes: list[str] | None = None) -> str:
        """Get URL to redirect user for authorization.

        Args:
            state: Random state string to prevent CSRF.
            scopes: OAuth scopes to request. Defaults to common Jira scopes.

        Returns:
            Authorization URL to redirect user to.
        """
        if scopes is None:
            scopes = [
                "read:jira-work",
                "write:jira-work",
                "read:jira-user",
                "manage:jira-project",
                "manage:jira-configuration",
            ]

        params = {
            "audience": "api.atlassian.com",
            "client_id": self._client_id,
            "scope": " ".join(scopes),
            "redirect_uri": self._redirect_uri,
            "state": state,
            "response_type": "code",
            "prompt": "consent",
        }

        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.AUTH_URL}?{query}"

    async def exchange_code(self, code: str) -> OAuth2Token:
        """Exchange authorization code for access token.

        Args:
            code: Authorization code from callback.

        Returns:
            OAuth2Token with access and refresh tokens.

        Raises:
            AuthenticationError: If exchange fails.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "code": code,
                    "redirect_uri": self._redirect_uri,
                },
            )

            if response.status_code != 200:
                raise AuthenticationError(f"Token exchange failed: {response.text}")

            self._token = OAuth2Token.from_response(response.json())
            return self._token

    async def _refresh_token(self) -> None:
        """Refresh the access token using refresh token."""
        if not self._token or not self._token.refresh_token:
            raise AuthenticationError("No refresh token available")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "refresh_token": self._token.refresh_token,
                },
            )

            if response.status_code != 200:
                raise AuthenticationError(f"Token refresh failed: {response.text}")

            self._token = OAuth2Token.from_response(response.json())

    async def get_cloud_id(self) -> str:
        """Get the Jira Cloud ID for API calls.

        The cloud ID is required for all Jira Cloud API calls when using OAuth.

        Returns:
            Cloud ID string.

        Raises:
            AuthenticationError: If unable to get cloud ID.
        """
        if self._cloud_id:
            return self._cloud_id

        if not self._token:
            raise AuthenticationError("Not authenticated")

        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.RESOURCE_URL,
                headers={"Authorization": f"Bearer {self._token.access_token}"},
            )

            if response.status_code != 200:
                raise AuthenticationError(f"Failed to get cloud ID: {response.text}")

            resources = response.json()
            if not resources:
                raise AuthenticationError("No accessible Jira resources found")

            # Use the first available resource
            self._cloud_id = resources[0]["id"]
            return self._cloud_id

    def get_auth_headers(self) -> dict[str, str]:
        """Get OAuth Bearer auth headers.

        Returns:
            Headers with Bearer token.

        Raises:
            AuthenticationError: If not authenticated.
        """
        if not self._token:
            raise AuthenticationError("Not authenticated - call exchange_code first")

        return {
            "Authorization": f"Bearer {self._token.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def refresh_if_needed(self) -> None:
        """Refresh token if expired or about to expire."""
        if self._token and self._token.is_expired:
            await self._refresh_token()

    @property
    def is_valid(self) -> bool:
        """Check if we have a valid, non-expired token."""
        return self._token is not None and not self._token.is_expired


def load_oauth_tokens_from_file() -> tuple[OAuth2Token, str] | None:
    """Load OAuth tokens from saved file.

    Returns:
        Tuple of (OAuth2Token, cloud_id) or None if not found.
    """
    import json
    from pathlib import Path

    token_file = Path(__file__).parent.parent / ".oauth_tokens.json"

    if not token_file.exists():
        return None

    try:
        data = json.loads(token_file.read_text())
        token = OAuth2Token(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", ""),
            expires_at=datetime.now() + timedelta(seconds=3600),  # Assume 1hr validity
            token_type=data.get("token_type", "Bearer"),
            scope=data.get("scope", ""),
        )
        cloud_id = data.get("cloud_id", "")
        return token, cloud_id
    except Exception:
        return None


def create_auth_provider(
    email: str | None = None,
    token: str | None = None,
    oauth_client_id: str | None = None,
    oauth_client_secret: str | None = None,
    oauth_redirect_uri: str | None = None,
) -> AuthProvider:
    """Factory function to create appropriate auth provider.

    As of January 2026, OAuth 2.0 (3LO) is the required method.
    API tokens are deprecated but kept as fallback during transition.

    Priority order:
    1. OAuth 2.0 with saved tokens
    2. API Token (legacy, deprecated Jan 2026)

    Args:
        email: Email for API token auth (legacy).
        token: API token (legacy).
        oauth_client_id: OAuth client ID.
        oauth_client_secret: OAuth client secret.
        oauth_redirect_uri: OAuth redirect URI.

    Returns:
        Configured AuthProvider instance.

    Raises:
        ConfigurationError: If no valid credentials provided.
    """
    # Priority 1: OAuth 2.0 with saved tokens (recommended)
    if oauth_client_id and oauth_client_secret:
        saved = load_oauth_tokens_from_file()
        if saved:
            oauth_token, cloud_id = saved
            auth = OAuth2Auth(
                client_id=oauth_client_id,
                client_secret=oauth_client_secret,
                redirect_uri=oauth_redirect_uri or "http://localhost:8080/callback",
                token=oauth_token,
            )
            auth._cloud_id = cloud_id
            return auth
        else:
            raise ConfigurationError(
                "OAuth 2.0 credentials found but not authorized yet.\nRun: python -m src.oauth_flow"
            )

    # Priority 2: API Token (legacy - deprecated Jan 2026)
    if email and token:
        import warnings

        warnings.warn(
            "API Token authentication is deprecated as of January 2026. "
            "Please migrate to OAuth 2.0.",
            DeprecationWarning,
            stacklevel=2,
        )
        return APITokenAuth(email=email, token=token)

    raise ConfigurationError(
        "No valid authentication credentials provided.\n"
        "Configure OAuth 2.0 in .env and run: python -m src.oauth_flow"
    )
