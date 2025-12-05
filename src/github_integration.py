"""
GitHub-Jira integration utilities.

Provides functions to:
- Extract Jira ticket IDs from commit messages and branch names
- Link GitHub PRs/commits to Jira tickets
- Sync PR status to Jira issue transitions
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog

if TYPE_CHECKING:
    from src.jira_client import JiraClient

logger = structlog.get_logger(__name__)

# Jira ticket pattern: PROJECT-123 (uppercase project key, dash, numbers)
JIRA_TICKET_PATTERN = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")


@dataclass
class GitHubContext:
    """GitHub context for PR/commit."""

    repo: str
    branch: str
    pr_number: int | None = None
    pr_title: str | None = None
    pr_url: str | None = None
    commit_sha: str | None = None
    commit_message: str | None = None


@dataclass
class JiraLink:
    """Jira ticket link information."""

    ticket_id: str
    source: str  # "branch", "commit", "pr_title"


def extract_ticket_ids(text: str) -> list[str]:
    """Extract all Jira ticket IDs from text.

    Args:
        text: Text to search (commit message, branch name, PR title).

    Returns:
        List of unique ticket IDs found.

    Example:
        >>> extract_ticket_ids("MGMT-123: Fix bug and MGMT-456")
        ['MGMT-123', 'MGMT-456']
    """
    if not text:
        return []
    matches = JIRA_TICKET_PATTERN.findall(text)
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for match in matches:
        if match not in seen:
            seen.add(match)
            unique.append(match)
    return unique


def extract_ticket_from_branch(branch_name: str) -> str | None:
    """Extract Jira ticket ID from branch name.

    Supports formats:
    - MGMT-123/feature-description
    - feature/MGMT-123-description
    - MGMT-123-description

    Args:
        branch_name: Git branch name.

    Returns:
        First ticket ID found or None.
    """
    tickets = extract_ticket_ids(branch_name)
    return tickets[0] if tickets else None


def find_all_tickets(ctx: GitHubContext) -> list[JiraLink]:
    """Find all Jira tickets referenced in GitHub context.

    Searches branch name, commit message, and PR title.

    Args:
        ctx: GitHub context with branch/commit/PR info.

    Returns:
        List of JiraLink objects with source information.
    """
    links: list[JiraLink] = []
    seen: set[str] = set()

    # Check branch name first (highest priority)
    branch_tickets = extract_ticket_ids(ctx.branch)
    for ticket in branch_tickets:
        if ticket not in seen:
            seen.add(ticket)
            links.append(JiraLink(ticket_id=ticket, source="branch"))

    # Check PR title
    if ctx.pr_title:
        pr_tickets = extract_ticket_ids(ctx.pr_title)
        for ticket in pr_tickets:
            if ticket not in seen:
                seen.add(ticket)
                links.append(JiraLink(ticket_id=ticket, source="pr_title"))

    # Check commit message
    if ctx.commit_message:
        commit_tickets = extract_ticket_ids(ctx.commit_message)
        for ticket in commit_tickets:
            if ticket not in seen:
                seen.add(ticket)
                links.append(JiraLink(ticket_id=ticket, source="commit"))

    return links


def format_github_comment(ctx: GitHubContext) -> str:
    """Format a comment for Jira with GitHub link.

    Args:
        ctx: GitHub context.

    Returns:
        Formatted comment string for Jira.
    """
    parts = []

    if ctx.pr_url and ctx.pr_title:
        parts.append(f"*Pull Request:* [{ctx.pr_title}|{ctx.pr_url}]")

    if ctx.commit_sha:
        commit_url = f"https://github.com/{ctx.repo}/commit/{ctx.commit_sha}"
        short_sha = ctx.commit_sha[:7]
        parts.append(f"*Commit:* [{short_sha}|{commit_url}]")
        if ctx.commit_message:
            # First line only
            first_line = ctx.commit_message.split("\n")[0]
            parts.append(f"_{first_line}_")

    parts.append(f"*Branch:* {ctx.branch}")

    return "\n".join(parts)


async def link_pr_to_tickets(
    client: "JiraClient",
    ctx: GitHubContext,
    transition_to: str | None = None,
) -> list[str]:
    """Link a GitHub PR to all referenced Jira tickets.

    Adds a comment to each ticket with PR details.
    Optionally transitions the ticket to a new status.

    Args:
        client: Jira API client.
        ctx: GitHub context with PR details.
        transition_to: Optional status to transition tickets to.

    Returns:
        List of ticket IDs that were updated.
    """
    links = find_all_tickets(ctx)
    if not links:
        logger.info("No Jira tickets found in GitHub context")
        return []

    comment = format_github_comment(ctx)
    updated_tickets = []

    for link in links:
        try:
            # Add comment with PR link
            await client.add_comment(link.ticket_id, comment)
            logger.info(
                "Added GitHub link to Jira ticket",
                ticket=link.ticket_id,
                source=link.source,
            )

            # Optionally transition the ticket
            if transition_to:
                try:
                    await client.transition_issue(link.ticket_id, transition_to)
                    logger.info(
                        "Transitioned ticket",
                        ticket=link.ticket_id,
                        to=transition_to,
                    )
                except Exception as e:
                    logger.warning(
                        "Failed to transition ticket",
                        ticket=link.ticket_id,
                        error=str(e),
                    )

            updated_tickets.append(link.ticket_id)

        except Exception as e:
            logger.error(
                "Failed to update Jira ticket",
                ticket=link.ticket_id,
                error=str(e),
            )

    return updated_tickets


def validate_commit_message(message: str) -> tuple[bool, str | None]:
    """Validate that commit message starts with Jira ticket ID.

    Args:
        message: Commit message to validate.

    Returns:
        Tuple of (is_valid, ticket_id or error message).

    Example:
        >>> validate_commit_message("MGMT-123: Add feature")
        (True, 'MGMT-123')
        >>> validate_commit_message("Add feature")
        (False, 'Commit message must start with Jira ticket ID')
    """
    if not message:
        return False, "Empty commit message"

    # Check if message starts with ticket pattern
    match = JIRA_TICKET_PATTERN.match(message)
    if match:
        return True, match.group(1)

    # Check if ticket appears anywhere (less strict)
    tickets = extract_ticket_ids(message)
    if tickets:
        return True, tickets[0]

    return False, "Commit message must include Jira ticket ID (e.g., MGMT-123)"


def validate_branch_name(branch: str) -> tuple[bool, str | None]:
    """Validate that branch name contains Jira ticket ID.

    Args:
        branch: Branch name to validate.

    Returns:
        Tuple of (is_valid, ticket_id or error message).

    Example:
        >>> validate_branch_name("MGMT-123/add-feature")
        (True, 'MGMT-123')
        >>> validate_branch_name("main")
        (True, None)  # Main branch is always valid
        >>> validate_branch_name("feature/no-ticket")
        (False, 'Branch name must include Jira ticket ID')
    """
    # Special branches are always valid
    special_branches = {"main", "master", "develop", "dev", "staging", "production"}
    if branch in special_branches:
        return True, None

    ticket = extract_ticket_from_branch(branch)
    if ticket:
        return True, ticket

    return False, "Branch name must include Jira ticket ID (e.g., MGMT-123/description)"
