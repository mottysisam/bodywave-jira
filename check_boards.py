#!/usr/bin/env python3
"""Check and report on Scrum boards for all projects."""

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.accounts import AccountManager
from src.jira_client import JiraClient
from src.config import Config
from src.auth import OAuth2Auth, OAuth2Token
from src.scrum_calculator import get_scrum_context, get_sprint_prefix


async def create_jira_client():
    """Create Jira client with OAuth authentication."""
    manager = AccountManager()
    account = manager.get_account("default")
    if not account:
        print("Error: bodywave account not found")
        return None

    oauth_token = OAuth2Token(
        access_token=account.access_token,
        refresh_token=account.refresh_token or "",
        expires_at=datetime.now() + timedelta(hours=1),
        token_type=account.token_type,
        scope=account.scope,
    )

    auth = OAuth2Auth(
        client_id="",
        client_secret="",
        redirect_uri="",
        token=oauth_token,
    )
    auth._cloud_id = account.cloud_id

    config = Config(
        jira_base_url=account.site_url,
        jira_user_email="",
        jira_api_token="",
        jira_oauth_client_id="",
        jira_oauth_client_secret="",
        jira_oauth_redirect_uri="",
    )

    client = JiraClient(config, auth_provider=auth)
    await client._ensure_client()
    return client


async def main():
    """Check boards and sprints for all projects."""
    # Project mapping
    projects = ["PROJ1", "PROJ2"]

    print("=" * 60)
    print("SCRUM BOARDS CHECK")
    print("=" * 60)

    # Show current Scrum context
    ctx = get_scrum_context()
    print(f"\nCurrent Context: {ctx.quarter_label} {ctx.pi_label} ({ctx.month_name} {ctx.year})")
    print(f"Sprint Prefix: {ctx.sprint_prefix}")
    print()

    client = await create_jira_client()
    if not client:
        return 1

    try:
        for project_key in projects:
            print(f"\n--- Project: {project_key} ---")

            # List boards for this project
            boards = await client.list_boards(project_key=project_key)

            if not boards:
                print(f"  No boards found for {project_key}")
                print(f"  -> Need to create a Scrum board manually in Jira UI")
                continue

            for board in boards:
                print(f"  Board: {board.name} (ID: {board.id}, Type: {board.type})")

                if board.type != "scrum":
                    print(f"    -> Not a Scrum board, skipping sprints check")
                    continue

                # List sprints for this board
                sprints = await client.list_sprints(board.id)

                if not sprints:
                    print(f"    No sprints found")
                else:
                    # Filter sprints matching current PI prefix
                    prefix = get_sprint_prefix()
                    current_pi_sprints = [s for s in sprints if s.name.startswith(prefix)]

                    print(f"    Total sprints: {len(sprints)}")
                    print(f"    Current PI sprints ({prefix}*): {len(current_pi_sprints)}")

                    for sprint in sprints[-5:]:  # Show last 5
                        state_icon = {"active": "🏃", "closed": "✅", "future": "📅"}.get(sprint.state, "❓")
                        print(f"      {state_icon} {sprint.name} ({sprint.state})")

        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)

        # Re-check to provide summary
        all_boards = await client.list_boards()
        scrum_boards = [b for b in all_boards if b.type == "scrum"]

        print(f"Total Scrum boards: {len(scrum_boards)}")
        for b in scrum_boards:
            proj = b.location.get("projectKey", "Unknown") if b.location else "Unknown"
            print(f"  - {proj}: {b.name} (ID: {b.id})")

        await client.close()
        return 0

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        await client.close()
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
