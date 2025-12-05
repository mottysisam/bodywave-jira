"""Tests for automation workflows."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.automation import (
    AutomationEngine,
    BulkOperations,
    IssueAutomation,
    IssueTransition,
    ScheduledTasks,
    SprintAutomation,
    WorkflowExecution,
    WorkflowRule,
    WorkflowTrigger,
)


@pytest.fixture
def mock_client() -> MagicMock:
    """Create a mock Jira client."""
    client = MagicMock()
    client.transition_issue = AsyncMock()
    client.add_comment = AsyncMock()
    client.update_issue = AsyncMock()
    client.move_issues_to_sprint = AsyncMock()
    client.get_issue = AsyncMock(return_value={"fields": {"labels": ["existing"]}})
    client.search_issues = AsyncMock(
        return_value={"issues": [{"key": "TEST-1"}, {"key": "TEST-2"}]}
    )
    client.get_sprint_issues = AsyncMock(
        return_value={
            "issues": [
                {
                    "key": "TEST-1",
                    "fields": {
                        "status": {"name": "To Do"},
                        "customfield_10016": 5,
                    },
                },
                {
                    "key": "TEST-2",
                    "fields": {
                        "status": {"name": "Done"},
                        "customfield_10016": 3,
                    },
                },
            ]
        }
    )
    return client


class TestWorkflowRule:
    """Tests for WorkflowRule dataclass."""

    def test_create_rule(self) -> None:
        """Should create a workflow rule."""
        rule = WorkflowRule(
            name="test_rule",
            trigger=WorkflowTrigger.ISSUE_CREATED,
            conditions={"project": "TEST"},
            actions=[{"type": "add_comment", "comment": "Hello"}],
        )
        assert rule.name == "test_rule"
        assert rule.trigger == WorkflowTrigger.ISSUE_CREATED
        assert rule.enabled is True

    def test_rule_defaults(self) -> None:
        """Should have correct defaults."""
        rule = WorkflowRule(
            name="minimal",
            trigger=WorkflowTrigger.SPRINT_STARTED,
        )
        assert rule.conditions == {}
        assert rule.actions == []
        assert rule.enabled is True


class TestAutomationEngine:
    """Tests for AutomationEngine."""

    @pytest.mark.asyncio
    async def test_register_rule(self, mock_client: MagicMock) -> None:
        """Should register a rule."""
        engine = AutomationEngine(mock_client)
        rule = WorkflowRule(
            name="test",
            trigger=WorkflowTrigger.ISSUE_CREATED,
        )
        engine.register_rule(rule)
        assert "test" in engine.rules

    @pytest.mark.asyncio
    async def test_execute_trigger_no_match(self, mock_client: MagicMock) -> None:
        """Should return empty when no rules match."""
        engine = AutomationEngine(mock_client)
        rule = WorkflowRule(
            name="test",
            trigger=WorkflowTrigger.SPRINT_STARTED,
        )
        engine.register_rule(rule)

        results = await engine.execute_trigger(
            WorkflowTrigger.ISSUE_CREATED, {"issue_key": "TEST-1"}
        )
        assert results == []

    @pytest.mark.asyncio
    async def test_execute_trigger_with_match(self, mock_client: MagicMock) -> None:
        """Should execute matching rules."""
        engine = AutomationEngine(mock_client)
        rule = WorkflowRule(
            name="test",
            trigger=WorkflowTrigger.ISSUE_CREATED,
            actions=[{"type": "add_comment", "comment": "Created!"}],
        )
        engine.register_rule(rule)

        results = await engine.execute_trigger(
            WorkflowTrigger.ISSUE_CREATED, {"issue_key": "TEST-1"}
        )
        assert len(results) == 1
        assert results[0].success is True

    @pytest.mark.asyncio
    async def test_condition_check(self, mock_client: MagicMock) -> None:
        """Should check conditions before executing."""
        engine = AutomationEngine(mock_client)
        rule = WorkflowRule(
            name="conditional",
            trigger=WorkflowTrigger.ISSUE_CREATED,
            conditions={"project": "TEST"},
            actions=[{"type": "add_comment", "comment": "Match!"}],
        )
        engine.register_rule(rule)

        # Should not match
        results = await engine.execute_trigger(
            WorkflowTrigger.ISSUE_CREATED, {"project": "OTHER"}
        )
        assert len(results) == 0

        # Should match
        results = await engine.execute_trigger(
            WorkflowTrigger.ISSUE_CREATED, {"project": "TEST", "issue_key": "TEST-1"}
        )
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_disabled_rule_not_executed(self, mock_client: MagicMock) -> None:
        """Should not execute disabled rules."""
        engine = AutomationEngine(mock_client)
        rule = WorkflowRule(
            name="disabled",
            trigger=WorkflowTrigger.ISSUE_CREATED,
            enabled=False,
        )
        engine.register_rule(rule)

        results = await engine.execute_trigger(
            WorkflowTrigger.ISSUE_CREATED, {"issue_key": "TEST-1"}
        )
        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_transition_action(self, mock_client: MagicMock) -> None:
        """Should execute transition action."""
        engine = AutomationEngine(mock_client)
        rule = WorkflowRule(
            name="transition",
            trigger=WorkflowTrigger.PR_OPENED,
            actions=[{"type": "transition_issue", "to_status": "In Review"}],
        )
        engine.register_rule(rule)

        await engine.execute_trigger(
            WorkflowTrigger.PR_OPENED, {"issue_key": "TEST-1"}
        )
        mock_client.transition_issue.assert_called_once_with("TEST-1", "In Review")

    @pytest.mark.asyncio
    async def test_comment_template_substitution(self, mock_client: MagicMock) -> None:
        """Should substitute template variables in comments."""
        engine = AutomationEngine(mock_client)
        rule = WorkflowRule(
            name="comment",
            trigger=WorkflowTrigger.PR_MERGED,
            actions=[{"type": "add_comment", "comment": "Merged: {pr_url}"}],
        )
        engine.register_rule(rule)

        await engine.execute_trigger(
            WorkflowTrigger.PR_MERGED,
            {"issue_key": "TEST-1", "pr_url": "https://github.com/test/pr/1"},
        )
        mock_client.add_comment.assert_called_once_with(
            "TEST-1", "Merged: https://github.com/test/pr/1"
        )


class TestSprintAutomation:
    """Tests for SprintAutomation."""

    @pytest.mark.asyncio
    async def test_setup_rules(self, mock_client: MagicMock) -> None:
        """Should set up default rules."""
        engine = AutomationEngine(mock_client)
        sprint_auto = SprintAutomation(engine)

        assert "move_incomplete_to_backlog" in engine.rules
        assert "sprint_start_notification" in engine.rules

    @pytest.mark.asyncio
    async def test_on_sprint_start(self, mock_client: MagicMock) -> None:
        """Should trigger sprint started event."""
        engine = AutomationEngine(mock_client)
        sprint_auto = SprintAutomation(engine)

        await sprint_auto.on_sprint_start(
            sprint_id=1, sprint_name="Sprint 1", issue_keys=["TEST-1"]
        )

        # Should have executed the sprint start notification
        assert len(engine.executions) >= 1

    @pytest.mark.asyncio
    async def test_on_sprint_close(self, mock_client: MagicMock) -> None:
        """Should trigger sprint closed event."""
        engine = AutomationEngine(mock_client)
        sprint_auto = SprintAutomation(engine)

        await sprint_auto.on_sprint_close(
            sprint_id=1,
            sprint_name="Sprint 1",
            completed_keys=["TEST-1"],
            incomplete_keys=["TEST-2"],
        )

        assert len(engine.executions) >= 1


class TestIssueAutomation:
    """Tests for IssueAutomation."""

    @pytest.mark.asyncio
    async def test_setup_rules(self, mock_client: MagicMock) -> None:
        """Should set up default rules."""
        engine = AutomationEngine(mock_client)
        issue_auto = IssueAutomation(engine)

        assert "pr_opens_in_review" in engine.rules
        assert "pr_merges_done" in engine.rules

    @pytest.mark.asyncio
    async def test_on_pr_opened(self, mock_client: MagicMock) -> None:
        """Should transition to In Review on PR open."""
        engine = AutomationEngine(mock_client)
        issue_auto = IssueAutomation(engine)

        await issue_auto.on_pr_opened(
            issue_key="TEST-1",
            pr_url="https://github.com/test/pr/1",
            pr_title="Add feature",
        )

        mock_client.transition_issue.assert_called_once_with("TEST-1", "In Review")

    @pytest.mark.asyncio
    async def test_on_pr_merged(self, mock_client: MagicMock) -> None:
        """Should transition to Done on PR merge."""
        engine = AutomationEngine(mock_client)
        issue_auto = IssueAutomation(engine)

        await issue_auto.on_pr_merged(
            issue_key="TEST-1",
            pr_url="https://github.com/test/pr/1",
        )

        mock_client.transition_issue.assert_called_once_with("TEST-1", "Done")
        mock_client.add_comment.assert_called_once()


class TestBulkOperations:
    """Tests for BulkOperations."""

    @pytest.mark.asyncio
    async def test_bulk_transition(self, mock_client: MagicMock) -> None:
        """Should transition multiple issues."""
        bulk = BulkOperations(mock_client)

        results = await bulk.bulk_transition(
            ["TEST-1", "TEST-2"], "In Progress"
        )

        assert results["TEST-1"] is True
        assert results["TEST-2"] is True
        assert mock_client.transition_issue.call_count == 2

    @pytest.mark.asyncio
    async def test_bulk_transition_partial_failure(self, mock_client: MagicMock) -> None:
        """Should handle partial failures."""
        mock_client.transition_issue.side_effect = [None, Exception("Failed")]
        bulk = BulkOperations(mock_client)

        results = await bulk.bulk_transition(["TEST-1", "TEST-2"], "Done")

        assert results["TEST-1"] is True
        assert results["TEST-2"] is False

    @pytest.mark.asyncio
    async def test_bulk_assign(self, mock_client: MagicMock) -> None:
        """Should assign multiple issues."""
        bulk = BulkOperations(mock_client)

        results = await bulk.bulk_assign(["TEST-1", "TEST-2"], "user123")

        assert results["TEST-1"] is True
        assert results["TEST-2"] is True
        assert mock_client.update_issue.call_count == 2

    @pytest.mark.asyncio
    async def test_bulk_add_labels(self, mock_client: MagicMock) -> None:
        """Should add labels to multiple issues."""
        bulk = BulkOperations(mock_client)

        results = await bulk.bulk_add_labels(["TEST-1"], ["new-label"])

        assert results["TEST-1"] is True
        mock_client.update_issue.assert_called_once()

    @pytest.mark.asyncio
    async def test_bulk_move_to_sprint(self, mock_client: MagicMock) -> None:
        """Should move issues to sprint."""
        bulk = BulkOperations(mock_client)

        result = await bulk.bulk_move_to_sprint(["TEST-1", "TEST-2"], sprint_id=5)

        assert result is True
        mock_client.move_issues_to_sprint.assert_called_once_with(
            5, ["TEST-1", "TEST-2"]
        )


class TestScheduledTasks:
    """Tests for ScheduledTasks."""

    @pytest.mark.asyncio
    async def test_check_stale_issues(self, mock_client: MagicMock) -> None:
        """Should find stale issues."""
        engine = AutomationEngine(mock_client)
        scheduler = ScheduledTasks(engine)

        stale = await scheduler.check_stale_issues("TEST", days_stale=7)

        assert stale == ["TEST-1", "TEST-2"]
        mock_client.search_issues.assert_called_once()

    @pytest.mark.asyncio
    async def test_check_sprint_capacity(self, mock_client: MagicMock) -> None:
        """Should calculate sprint capacity."""
        engine = AutomationEngine(mock_client)
        scheduler = ScheduledTasks(engine)

        capacity = await scheduler.check_sprint_capacity(board_id=1, sprint_id=5)

        assert capacity["total_issues"] == 2
        assert capacity["total_points"] == 8
        assert capacity["by_status"]["To Do"] == 1
        assert capacity["by_status"]["Done"] == 1

    @pytest.mark.asyncio
    async def test_start_stop(self, mock_client: MagicMock) -> None:
        """Should start and stop scheduler."""
        engine = AutomationEngine(mock_client)
        scheduler = ScheduledTasks(engine)

        await scheduler.start()
        assert scheduler._running is True

        await scheduler.stop()
        assert scheduler._running is False
