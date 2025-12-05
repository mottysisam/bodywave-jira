#!/usr/bin/env python3
"""
Bodywave Jira MCP Server - Main Entry Point

This script provides verification and demonstration functionality.

Usage:
    # Verify connection
    python main.py --verify

    # Run demo (creates, updates, deletes a test issue)
    python main.py --demo

    # Get status
    python main.py --status

    # Interactive mode
    python main.py --interactive
"""

import argparse
import asyncio
import json
import sys
from datetime import date

import structlog

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.dev.ConsoleRenderer(colors=True),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)


async def verify_connection() -> bool:
    """Verify Jira connection is working.

    Returns:
        True if connection is valid.
    """
    from src.config import load_config
    from src.jira_client import JiraClient

    print("=" * 60)
    print("Verifying Jira Connection")
    print("=" * 60)

    try:
        config = load_config()
        print(f"\nJira URL: {config.jira_base_url}")
        print(f"User Email: {config.jira_user_email}")

        async with JiraClient(config) as client:
            user = await client.get_myself()

            print(f"\n✅ Connection successful!")
            print(f"   Logged in as: {user.get('displayName')}")
            print(f"   Email: {user.get('emailAddress')}")
            print(f"   Account ID: {user.get('accountId')}")

            # List projects
            projects = await client.list_projects()
            print(f"\n📁 Accessible Projects ({len(projects)}):")
            for project in projects:
                print(f"   - {project.key}: {project.name}")

            return True

    except Exception as e:
        print(f"\n❌ Connection failed: {e}")
        return False


async def run_demo() -> bool:
    """Run a demonstration of basic CRUD operations.

    Creates a test issue, updates it, and then deletes it.

    Returns:
        True if demo completed successfully.
    """
    from src.config import load_config, load_projects_config
    from src.jira_client import JiraClient

    print("=" * 60)
    print("Running Jira CRUD Demo")
    print("=" * 60)
    print("\n⚠️  This will create a test issue in your Jira instance.")
    print("   The issue will be deleted at the end of the demo.\n")

    # Ask for confirmation
    response = input("Continue? (y/N): ")
    if response.lower() != "y":
        print("Demo cancelled.")
        return False

    try:
        config = load_config()
        projects_config = load_projects_config()

        # Use first configured project
        if not projects_config.projects:
            print("❌ No projects configured in config/projects.json")
            return False

        project_key = projects_config.projects[0].key
        print(f"\nUsing project: {project_key}")

        async with JiraClient(config) as client:
            # 1. Create issue
            print("\n📝 Creating test issue...")
            issue = await client.create_issue(
                project_key=project_key,
                summary=f"[TEST] Bodywave MCP Demo Issue - {date.today()}",
                description="This is a test issue created by the Bodywave Jira MCP Server demo.",
                issue_type="Task",
                labels=["test", "demo", "mcp"],
            )
            print(f"   ✅ Created: {issue.key}")
            print(f"      Summary: {issue.summary}")
            print(f"      Status: {issue.status}")

            # 2. Update issue
            print("\n✏️  Updating issue...")
            updated = await client.update_issue(
                issue_key=issue.key,
                summary=f"[TEST-UPDATED] Bodywave MCP Demo - {date.today()}",
                description="Updated description from MCP demo.",
            )
            print(f"   ✅ Updated: {updated.key}")
            print(f"      New Summary: {updated.summary}")

            # 3. Add comment
            print("\n💬 Adding comment...")
            await client.add_comment(
                issue_key=issue.key,
                body="This comment was added by the Bodywave Jira MCP Server demo.",
            )
            print("   ✅ Comment added")

            # 4. Search for the issue
            print("\n🔍 Searching for issue...")
            result = await client.search_issues_jql(f"key = {issue.key}")
            if result.issues:
                found = result.issues[0]
                print(f"   ✅ Found: {found.key}")
                print(f"      Labels: {found.labels}")

            # 5. Delete issue
            print("\n🗑️  Deleting test issue...")
            await client.delete_issue(issue.key)
            print(f"   ✅ Deleted: {issue.key}")

            print("\n" + "=" * 60)
            print("✅ Demo completed successfully!")
            print("=" * 60)
            return True

    except Exception as e:
        print(f"\n❌ Demo failed: {e}")
        logger.exception("Demo failed")
        return False


async def show_status() -> None:
    """Show current MCP orchestrator status."""
    from src.mcp_orchestrator import MCPOrchestrator, CommandType, MCPCommand

    print("=" * 60)
    print("Bodywave Jira MCP Server Status")
    print("=" * 60)

    try:
        async with MCPOrchestrator() as orchestrator:
            # Get status
            response = await orchestrator.execute(
                MCPCommand(type=CommandType.GET_STATUS)
            )
            print("\n" + response.to_json())

            # Get current PI
            pi_response = await orchestrator.execute(
                MCPCommand(type=CommandType.GET_CURRENT_PI)
            )
            if pi_response.success:
                pi = pi_response.data
                print(f"\n📅 Current Program Increment:")
                print(f"   Name: {pi.name}")
                print(f"   Start: {pi.start_date}")
                print(f"   End: {pi.end_date}")
                print(f"   Is Current: {pi.is_current}")

    except Exception as e:
        print(f"\n❌ Failed to get status: {e}")


async def interactive_mode() -> None:
    """Run interactive command mode."""
    from src.mcp_orchestrator import MCPOrchestrator, CommandType

    print("=" * 60)
    print("Bodywave Jira MCP Server - Interactive Mode")
    print("=" * 60)
    print("\nAvailable commands:")
    for cmd in CommandType:
        print(f"  - {cmd.value}")
    print("\nType 'quit' or 'exit' to exit.")
    print("Commands are in JSON format: {\"command\": \"...\", ...}")
    print()

    try:
        async with MCPOrchestrator() as orchestrator:
            while True:
                try:
                    user_input = input("mcp> ").strip()

                    if not user_input:
                        continue

                    if user_input.lower() in ("quit", "exit"):
                        print("Goodbye!")
                        break

                    # Parse JSON command
                    try:
                        command_dict = json.loads(user_input)
                    except json.JSONDecodeError:
                        # Try as simple command
                        command_dict = {"command": user_input}

                    response = await orchestrator.execute_raw(command_dict)
                    print(response.to_json())
                    print()

                except KeyboardInterrupt:
                    print("\nGoodbye!")
                    break
                except Exception as e:
                    print(f"Error: {e}")

    except Exception as e:
        print(f"\n❌ Failed to start interactive mode: {e}")


async def show_pi_info() -> None:
    """Show Program Increment information."""
    from src.agile_manager import AgileManager
    from src.config import load_config, load_projects_config
    from src.jira_client import JiraClient

    print("=" * 60)
    print("Program Increment Information")
    print("=" * 60)

    try:
        config = load_config()
        projects_config = load_projects_config()

        async with JiraClient(config) as client:
            agile = AgileManager(client, projects_config)

            # Current PI
            current_pi = agile.get_current_pi()
            print(f"\n📅 Current PI: {current_pi.name}")
            print(f"   Start: {current_pi.start_date}")
            print(f"   End: {current_pi.end_date}")
            print(f"   Is Active: {current_pi.is_current}")

            # Next PI
            next_pi = agile.get_next_pi(current_pi)
            print(f"\n📅 Next PI: {next_pi.name}")
            print(f"   Start: {next_pi.start_date}")
            print(f"   End: {next_pi.end_date}")

            # Sprints for current PI
            print(f"\n🔄 Sprint Schedule for {current_pi.name}:")
            for project in projects_config.projects:
                print(f"\n   Project: {project.key}")
                for i in range(1, project.sprints_per_pi + 1):
                    start, end = agile.calculate_sprint_dates(current_pi, i, project)
                    name = agile.generate_sprint_name(current_pi, i, project)
                    print(f"      Sprint {i}: {start} to {end}")
                    print(f"               Name: {name}")

    except Exception as e:
        print(f"\n❌ Failed to get PI info: {e}")


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Bodywave Jira MCP Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python main.py --verify          Verify Jira connection
    python main.py --demo            Run CRUD demonstration
    python main.py --status          Show MCP status
    python main.py --pi              Show PI information
    python main.py --interactive     Start interactive mode
        """,
    )

    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify Jira connection",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run CRUD demonstration",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show MCP status",
    )
    parser.add_argument(
        "--pi",
        action="store_true",
        help="Show Program Increment information",
    )
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Start interactive command mode",
    )

    args = parser.parse_args()

    # Default to verify if no arguments
    if not any([args.verify, args.demo, args.status, args.pi, args.interactive]):
        args.verify = True

    try:
        if args.verify:
            success = asyncio.run(verify_connection())
            return 0 if success else 1

        if args.demo:
            success = asyncio.run(run_demo())
            return 0 if success else 1

        if args.status:
            asyncio.run(show_status())
            return 0

        if args.pi:
            asyncio.run(show_pi_info())
            return 0

        if args.interactive:
            asyncio.run(interactive_mode())
            return 0

    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130

    except Exception as e:
        print(f"\n❌ Error: {e}")
        logger.exception("Unhandled error")
        return 1

    return 0


def verify() -> int:
    """Entry point for jira-verify command."""
    return main()


if __name__ == "__main__":
    sys.exit(main())
