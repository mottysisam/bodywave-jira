"""Tests for GitHub-Jira integration utilities."""

from src.github_integration import (
    GitHubContext,
    JiraLink,
    extract_ticket_from_branch,
    extract_ticket_ids,
    find_all_tickets,
    format_github_comment,
    validate_branch_name,
    validate_commit_message,
)


class TestExtractTicketIds:
    """Tests for extract_ticket_ids function."""

    def test_single_ticket(self) -> None:
        """Should extract single ticket ID."""
        result = extract_ticket_ids("MGMT-123: Add feature")
        assert result == ["MGMT-123"]

    def test_multiple_tickets(self) -> None:
        """Should extract multiple ticket IDs."""
        result = extract_ticket_ids("MGMT-123: Fix MGMT-456 and BCM-789")
        assert result == ["MGMT-123", "MGMT-456", "BCM-789"]

    def test_no_tickets(self) -> None:
        """Should return empty list when no tickets found."""
        result = extract_ticket_ids("Add feature without ticket")
        assert result == []

    def test_empty_string(self) -> None:
        """Should handle empty string."""
        result = extract_ticket_ids("")
        assert result == []

    def test_deduplicate(self) -> None:
        """Should deduplicate ticket IDs."""
        result = extract_ticket_ids("MGMT-123 fix MGMT-123 again")
        assert result == ["MGMT-123"]

    def test_lowercase_not_matched(self) -> None:
        """Should not match lowercase project keys."""
        result = extract_ticket_ids("mgmt-123: lowercase")
        assert result == []


class TestExtractTicketFromBranch:
    """Tests for extract_ticket_from_branch function."""

    def test_ticket_slash_description(self) -> None:
        """Should extract from TICKET/description format."""
        result = extract_ticket_from_branch("MGMT-123/add-feature")
        assert result == "MGMT-123"

    def test_feature_slash_ticket(self) -> None:
        """Should extract from feature/TICKET format."""
        result = extract_ticket_from_branch("feature/MGMT-456-description")
        assert result == "MGMT-456"

    def test_ticket_dash_description(self) -> None:
        """Should extract from TICKET-description format."""
        result = extract_ticket_from_branch("BCM-789-fix-bug")
        assert result == "BCM-789"

    def test_no_ticket(self) -> None:
        """Should return None when no ticket found."""
        result = extract_ticket_from_branch("feature/add-something")
        assert result is None


class TestFindAllTickets:
    """Tests for find_all_tickets function."""

    def test_ticket_in_branch_only(self) -> None:
        """Should find ticket in branch name."""
        ctx = GitHubContext(
            repo="org/repo",
            branch="MGMT-123/feature",
        )
        result = find_all_tickets(ctx)
        assert len(result) == 1
        assert result[0] == JiraLink(ticket_id="MGMT-123", source="branch")

    def test_ticket_in_pr_title(self) -> None:
        """Should find ticket in PR title."""
        ctx = GitHubContext(
            repo="org/repo",
            branch="feature/something",
            pr_title="MGMT-456: Add feature",
        )
        result = find_all_tickets(ctx)
        assert len(result) == 1
        assert result[0] == JiraLink(ticket_id="MGMT-456", source="pr_title")

    def test_ticket_in_commit(self) -> None:
        """Should find ticket in commit message."""
        ctx = GitHubContext(
            repo="org/repo",
            branch="feature/something",
            commit_message="BCM-789: Fix bug",
        )
        result = find_all_tickets(ctx)
        assert len(result) == 1
        assert result[0] == JiraLink(ticket_id="BCM-789", source="commit")

    def test_deduplicate_across_sources(self) -> None:
        """Should deduplicate tickets from different sources."""
        ctx = GitHubContext(
            repo="org/repo",
            branch="MGMT-123/feature",
            pr_title="MGMT-123: Add feature",
            commit_message="MGMT-123: Implementation",
        )
        result = find_all_tickets(ctx)
        assert len(result) == 1
        assert result[0].source == "branch"  # First source wins


class TestFormatGitHubComment:
    """Tests for format_github_comment function."""

    def test_full_context(self) -> None:
        """Should format comment with all fields."""
        ctx = GitHubContext(
            repo="org/repo",
            branch="MGMT-123/feature",
            pr_number=42,
            pr_title="Add new feature",
            pr_url="https://github.com/org/repo/pull/42",
            commit_sha="abc123def456",
            commit_message="MGMT-123: Implementation details",
        )
        result = format_github_comment(ctx)
        assert "Add new feature" in result
        assert "https://github.com/org/repo/pull/42" in result
        assert "abc123d" in result  # Short SHA
        assert "MGMT-123/feature" in result


class TestValidateCommitMessage:
    """Tests for validate_commit_message function."""

    def test_valid_message_at_start(self) -> None:
        """Should validate message starting with ticket."""
        valid, ticket = validate_commit_message("MGMT-123: Add feature")
        assert valid is True
        assert ticket == "MGMT-123"

    def test_valid_message_in_text(self) -> None:
        """Should validate message with ticket in text."""
        valid, ticket = validate_commit_message("Fix bug in MGMT-456")
        assert valid is True
        assert ticket == "MGMT-456"

    def test_invalid_message(self) -> None:
        """Should invalidate message without ticket."""
        valid, error = validate_commit_message("Add feature")
        assert valid is False
        assert "Jira ticket ID" in str(error)

    def test_empty_message(self) -> None:
        """Should handle empty message."""
        valid, error = validate_commit_message("")
        assert valid is False
        assert "Empty" in str(error)


class TestValidateBranchName:
    """Tests for validate_branch_name function."""

    def test_valid_branch(self) -> None:
        """Should validate branch with ticket."""
        valid, ticket = validate_branch_name("MGMT-123/feature")
        assert valid is True
        assert ticket == "MGMT-123"

    def test_main_branch(self) -> None:
        """Should allow main branch without ticket."""
        valid, ticket = validate_branch_name("main")
        assert valid is True
        assert ticket is None

    def test_develop_branch(self) -> None:
        """Should allow develop branch without ticket."""
        valid, ticket = validate_branch_name("develop")
        assert valid is True
        assert ticket is None

    def test_invalid_branch(self) -> None:
        """Should invalidate branch without ticket."""
        valid, error = validate_branch_name("feature/no-ticket")
        assert valid is False
        assert "Jira ticket ID" in str(error)
