#!/usr/bin/env python3
"""
OAuth 2.0 (3LO) Authorization Flow for Bodywave Jira MCP Server.

This module handles the one-time authorization flow to obtain OAuth tokens.
Run this script to authorize the app and save tokens for future use.

Usage:
    python -m src.oauth_flow
"""

import asyncio
import json
import secrets
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urlencode

import httpx

from src.config import load_config

# Token storage file
TOKEN_FILE = Path(__file__).parent.parent / ".oauth_tokens.json"

# Atlassian OAuth endpoints
AUTH_URL = "https://auth.atlassian.com/authorize"
TOKEN_URL = "https://auth.atlassian.com/oauth/token"
RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """HTTP handler for OAuth callback."""

    auth_code: str | None = None
    state: str | None = None
    error: str | None = None

    def do_GET(self) -> None:
        """Handle OAuth callback GET request."""
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if "error" in params:
            OAuthCallbackHandler.error = params["error"][0]
            self._send_response("Authorization failed. You can close this window.")
            return

        if "code" in params:
            OAuthCallbackHandler.auth_code = params["code"][0]
            OAuthCallbackHandler.state = params.get("state", [None])[0]
            self._send_response(
                "Authorization successful! You can close this window and return to the terminal."
            )
        else:
            self._send_response("Invalid callback. Missing authorization code.")

    def _send_response(self, message: str) -> None:
        """Send HTML response."""
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>Bodywave Jira OAuth</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Bodywave Jira MCP Server</h1>
            <p>{message}</p>
        </body>
        </html>
        """
        self.wfile.write(html.encode())

    def log_message(self, format: str, *args) -> None:
        """Suppress HTTP server logs."""
        pass


def get_authorization_url(client_id: str, redirect_uri: str, state: str) -> str:
    """Build the authorization URL."""
    # Classic Jira platform REST API scopes (configured in Atlassian Developer Console)
    scopes = [
        "read:jira-work",
        "write:jira-work",
        "read:jira-user",
        "manage:jira-project",
        "manage:jira-configuration",
        "manage:jira-data-provider",
        "manage:jira-webhook",
        "offline_access",  # For refresh tokens
        # Jira Software (Agile) API scopes - for boards and sprints
        "read:board-scope:jira-software",
        "read:sprint:jira-software",
        "write:sprint:jira-software",
    ]

    params = {
        "audience": "api.atlassian.com",
        "client_id": client_id,
        "scope": " ".join(scopes),
        "redirect_uri": redirect_uri,
        "state": state,
        "response_type": "code",
        "prompt": "consent",
    }

    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_tokens(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    """Exchange authorization code for access and refresh tokens."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )

        if response.status_code != 200:
            raise Exception(f"Token exchange failed: {response.text}")

        return response.json()


async def get_accessible_resources(access_token: str) -> list[dict]:
    """Get accessible Jira Cloud resources."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            RESOURCES_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if response.status_code != 200:
            raise Exception(f"Failed to get resources: {response.text}")

        return response.json()


def save_tokens(tokens: dict, cloud_id: str, site_name: str, site_url: str, set_default: bool = False) -> None:
    """Save tokens to accounts manager."""
    from src.accounts import account_manager

    account_manager.add_account(
        name=site_name,
        cloud_id=cloud_id,
        site_url=site_url,
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token"),
        token_type=tokens.get("token_type", "Bearer"),
        scope=tokens.get("scope", ""),
        set_default=set_default,
    )

    # Also save to legacy file for backwards compatibility
    data = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_in": tokens.get("expires_in"),
        "token_type": tokens.get("token_type", "Bearer"),
        "scope": tokens.get("scope"),
        "cloud_id": cloud_id,
    }
    TOKEN_FILE.write_text(json.dumps(data, indent=2))

    print(f"\n✅ Account '{site_name}' saved")


def load_tokens() -> dict | None:
    """Load tokens from file."""
    if not TOKEN_FILE.exists():
        return None

    try:
        return json.loads(TOKEN_FILE.read_text())
    except Exception:
        return None


async def refresh_access_token(
    refresh_token: str,
    client_id: str,
    client_secret: str,
) -> dict:
    """Refresh the access token."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
            },
        )

        if response.status_code != 200:
            raise Exception(f"Token refresh failed: {response.text}")

        return response.json()


def run_oauth_flow() -> None:
    """Run the complete OAuth 2.0 authorization flow."""
    print("=" * 60)
    print("Bodywave Jira MCP Server - OAuth 2.0 Authorization")
    print("=" * 60)

    # Load config
    config = load_config()

    if not config.jira_oauth_client_id or not config.jira_oauth_client_secret:
        print("\n❌ OAuth credentials not configured in .env")
        print("   Set JIRA_OAUTH_CLIENT_ID and JIRA_OAUTH_CLIENT_SECRET")
        return

    redirect_uri = config.jira_oauth_redirect_uri or "http://localhost:8080/callback"

    # Parse port from redirect URI
    parsed = urlparse(redirect_uri)
    port = parsed.port or 8080

    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)

    # Build authorization URL
    auth_url = get_authorization_url(
        client_id=config.jira_oauth_client_id,
        redirect_uri=redirect_uri,
        state=state,
    )

    print(f"\n📋 Opening browser for authorization...")
    print(f"   If browser doesn't open, visit:\n   {auth_url}\n")

    # Start local server to receive callback
    server = HTTPServer(("localhost", port), OAuthCallbackHandler)
    server.timeout = 120  # 2 minute timeout

    # Open browser
    webbrowser.open(auth_url)

    print(f"⏳ Waiting for authorization (timeout: 2 minutes)...")

    # Wait for callback
    while OAuthCallbackHandler.auth_code is None and OAuthCallbackHandler.error is None:
        server.handle_request()

    server.server_close()

    if OAuthCallbackHandler.error:
        print(f"\n❌ Authorization failed: {OAuthCallbackHandler.error}")
        return

    if OAuthCallbackHandler.state != state:
        print("\n❌ State mismatch - possible CSRF attack")
        return

    code = OAuthCallbackHandler.auth_code
    print("\n✅ Authorization code received")

    # Exchange code for tokens
    print("🔄 Exchanging code for tokens...")

    async def complete_flow():
        tokens = await exchange_code_for_tokens(
            code=code,
            client_id=config.jira_oauth_client_id,
            client_secret=config.jira_oauth_client_secret,
            redirect_uri=redirect_uri,
        )

        print("✅ Tokens received")

        # Get accessible resources
        print("🔍 Getting accessible Jira sites...")
        resources = await get_accessible_resources(tokens["access_token"])

        if not resources:
            print("\n❌ No accessible Jira sites found")
            return

        print(f"\n📁 Accessible Jira Sites ({len(resources)}):")
        for i, resource in enumerate(resources):
            print(f"   {i + 1}. {resource['name']} ({resource['url']})")
            print(f"      Cloud ID: {resource['id']}")

        # Use first resource (or let user choose if multiple)
        selected = resources[0]
        site_name = selected['name']
        site_url = selected['url']
        print(f"\n✅ Using: {site_name}")

        # Check if this is the first account (to set as default)
        from src.accounts import account_manager
        is_first = len(account_manager.list_accounts()) == 0

        # Save tokens with site info
        save_tokens(tokens, selected["id"], site_name, site_url, set_default=is_first)

        print("\n" + "=" * 60)
        print("✅ OAuth setup complete!")
        print("=" * 60)
        print("\nYou can now run the MCP server:")
        print("   python main.py --verify")

    asyncio.run(complete_flow())


if __name__ == "__main__":
    run_oauth_flow()
