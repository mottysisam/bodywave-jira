#!/usr/bin/env python3
"""
Script to transition Jira tickets based on git activity.

Usage:
    python scripts/transition_tickets.py --tickets MGMT-2,MGMT-3 --status "Done"
    python scripts/transition_tickets.py --tickets MGMT-4 --status "In Progress"
"""

import argparse
import asyncio
import base64
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

JIRA_BASE_URL = os.getenv("JIRA_BASE_URL", "https://bodywave.atlassian.net")
JIRA_USER_EMAIL = os.getenv("JIRA_USER_EMAIL")
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN")


def get_auth_header() -> dict[str, str]:
    """Get authentication header for Jira API."""
    if not JIRA_USER_EMAIL or not JIRA_API_TOKEN:
        raise ValueError("JIRA_USER_EMAIL and JIRA_API_TOKEN must be set")

    auth_string = base64.b64encode(
        f"{JIRA_USER_EMAIL}:{JIRA_API_TOKEN}".encode()
    ).decode()

    return {
        "Authorization": f"Basic {auth_string}",
        "Content-Type": "application/json",
    }


async def get_transitions(client: httpx.AsyncClient, issue_key: str) -> list[dict]:
    """Get available transitions for an issue."""
    url = f"{JIRA_BASE_URL}/rest/api/3/issue/{issue_key}/transitions"
    response = await client.get(url, headers=get_auth_header())
    response.raise_for_status()
    return response.json().get("transitions", [])


async def transition_issue(
    client: httpx.AsyncClient,
    issue_key: str,
    target_status: str
) -> bool:
    """Transition an issue to a target status."""
    # Get available transitions
    transitions = await get_transitions(client, issue_key)

    # Find transition matching target status
    transition_id = None
    for t in transitions:
        if t["name"].lower() == target_status.lower():
            transition_id = t["id"]
            break
        # Also check "to" status name
        to_status = t.get("to", {}).get("name", "")
        if to_status.lower() == target_status.lower():
            transition_id = t["id"]
            break

    if not transition_id:
        available = [t["name"] for t in transitions]
        print(f"  Warning: '{target_status}' not available for {issue_key}")
        print(f"  Available transitions: {available}")
        return False

    # Execute transition
    url = f"{JIRA_BASE_URL}/rest/api/3/issue/{issue_key}/transitions"
    payload = {"transition": {"id": transition_id}}

    response = await client.post(url, headers=get_auth_header(), json=payload)
    response.raise_for_status()

    return True


async def get_issue_status(client: httpx.AsyncClient, issue_key: str) -> str:
    """Get current status of an issue."""
    url = f"{JIRA_BASE_URL}/rest/api/3/issue/{issue_key}"
    response = await client.get(url, headers=get_auth_header())
    response.raise_for_status()
    return response.json()["fields"]["status"]["name"]


async def main(tickets: list[str], target_status: str) -> None:
    """Main function to transition tickets."""
    print(f"Transitioning {len(tickets)} tickets to '{target_status}'")
    print("-" * 50)

    async with httpx.AsyncClient(timeout=30.0) as client:
        for ticket in tickets:
            try:
                # Get current status
                current = await get_issue_status(client, ticket)
                print(f"{ticket}: {current}", end="")

                if current.lower() == target_status.lower():
                    print(f" -> Already {target_status}")
                    continue

                # Transition
                success = await transition_issue(client, ticket, target_status)
                if success:
                    print(f" -> {target_status} ✓")
                else:
                    print(f" -> Failed")

            except Exception as e:
                print(f" -> Error: {e}")

    print("-" * 50)
    print("Done!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transition Jira tickets")
    parser.add_argument(
        "--tickets",
        required=True,
        help="Comma-separated list of ticket keys"
    )
    parser.add_argument(
        "--status",
        required=True,
        help="Target status (e.g., 'In Progress', 'Done')"
    )

    args = parser.parse_args()
    tickets = [t.strip() for t in args.tickets.split(",")]

    asyncio.run(main(tickets, args.status))
