#!/usr/bin/env python3
"""Verify Jira ticket creation in MGMT project."""

import asyncio
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from src.accounts import AccountManager
from src.auth import OAuth2Auth, OAuth2Token
from src.config import Config
from src.jira_client import JiraClient
from datetime import datetime, timedelta


async def main():
    """Verify ticket creation."""
    print("Loading bodywave account...")
    manager = AccountManager()
    account = manager.get_account("bodywave")

    if not account:
        print("❌ bodywave account not found")
        return

    print(f"✅ Found account: {account.name}")
    print(f"   Site URL: {account.site_url}")
    print(f"   Cloud ID: {account.cloud_id}")

    # Create OAuth token
    print("\nCreating OAuth token...")
    oauth_token = OAuth2Token(
        access_token=account.access_token,
        refresh_token=account.refresh_token or "",
        expires_at=datetime.now() + timedelta(hours=1),  # Assume 1 hour validity
        token_type=account.token_type,
        scope=account.scope,
    )

    # Create OAuth auth provider
    print("Creating OAuth auth provider...")
    auth = OAuth2Auth(
        client_id="",
        client_secret="",
        redirect_uri="",
        token=oauth_token,
    )
    auth._cloud_id = account.cloud_id

    # Create config
    config = Config(
        jira_base_url=account.site_url,
        jira_user_email="",
        jira_api_token="",
        jira_oauth_client_id="",
        jira_oauth_client_secret="",
        jira_oauth_redirect_uri="",
    )

    # Create client
    print("Creating Jira client...")
    client = JiraClient(config, auth_provider=auth)
    await client._ensure_client()

    print("✅ Client created successfully")

    # Search for recent tickets in MGMT project
    print("\nSearching for tickets in MGMT project...")
    result = await client.search_issues_jql(
        jql="project = MGMT ORDER BY created DESC",
        max_results=10
    )

    print(f"\n📊 Found {result.total} tickets in MGMT project")
    print(f"   Showing {len(result.issues)} most recent:\n")

    for issue in result.issues:
        print(f"🎫 {issue.key}: {issue.summary}")
        print(f"   Type: {issue.issue_type}")
        print(f"   Status: {issue.status}")
        print(f"   Created: {issue.created}")
        print(f"   Labels: {', '.join(issue.labels) if issue.labels else 'None'}")
        print()

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
