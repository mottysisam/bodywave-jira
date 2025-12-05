"""
Tests for AgileManager.
"""

from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.agile_manager import AgileManager
from src.config import ProjectsConfig
from src.models import ProgramIncrement, Sprint, SprintState


class TestAgileManagerPI:
    """Tests for Program Increment operations."""

    def test_get_current_pi_q1(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting PI for Q1."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        pi = agile.get_current_pi(date(2025, 2, 15))

        assert pi.year == 2025
        assert pi.quarter == 1
        assert pi.name == "PI-2025-Q1"
        assert pi.start_date == date(2025, 1, 1)
        assert pi.end_date == date(2025, 3, 31)

    def test_get_current_pi_q4(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting PI for Q4."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        pi = agile.get_current_pi(date(2025, 11, 15))

        assert pi.year == 2025
        assert pi.quarter == 4
        assert pi.name == "PI-2025-Q4"
        assert pi.start_date == date(2025, 10, 1)
        assert pi.end_date == date(2025, 12, 31)

    def test_get_next_pi(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting next PI."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        current_pi = agile.get_current_pi(date(2025, 2, 15))
        next_pi = agile.get_next_pi(current_pi)

        assert next_pi.year == 2025
        assert next_pi.quarter == 2
        assert next_pi.name == "PI-2025-Q2"

    def test_get_next_pi_year_rollover(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting next PI with year rollover."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        q4_pi = agile.get_current_pi(date(2025, 11, 15))
        next_pi = agile.get_next_pi(q4_pi)

        assert next_pi.year == 2026
        assert next_pi.quarter == 1

    def test_get_previous_pi(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting previous PI."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        current_pi = agile.get_current_pi(date(2025, 5, 15))
        prev_pi = agile.get_previous_pi(current_pi)

        assert prev_pi.year == 2025
        assert prev_pi.quarter == 1

    def test_get_previous_pi_year_rollover(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting previous PI with year rollover."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        q1_pi = agile.get_current_pi(date(2025, 2, 15))
        prev_pi = agile.get_previous_pi(q1_pi)

        assert prev_pi.year == 2024
        assert prev_pi.quarter == 4

    def test_get_pis_for_year(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting all PIs for a year."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        pis = agile.get_pis_for_year(2025)

        assert len(pis) == 4
        assert pis[0].quarter == 1
        assert pis[3].quarter == 4


class TestAgileManagerSprints:
    """Tests for Sprint operations."""

    def test_calculate_sprint_dates(self, mock_projects_config: ProjectsConfig) -> None:
        """Test calculating sprint dates."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        project_config = mock_projects_config.get_project("TEST")
        assert project_config is not None

        pi = agile.get_current_pi(date(2025, 1, 15))

        # Sprint 1
        start, end = agile.calculate_sprint_dates(pi, 1, project_config)
        assert start == date(2025, 1, 1)
        assert end == date(2025, 1, 14)

        # Sprint 2
        start, end = agile.calculate_sprint_dates(pi, 2, project_config)
        assert start == date(2025, 1, 15)
        assert end == date(2025, 1, 28)

    def test_generate_sprint_name(self, mock_projects_config: ProjectsConfig) -> None:
        """Test generating sprint names."""
        client = MagicMock()
        agile = AgileManager(client, mock_projects_config)

        project_config = mock_projects_config.get_project("TEST")
        assert project_config is not None

        pi = agile._create_pi(2025, 1)
        name = agile.generate_sprint_name(pi, 3, project_config)

        assert name == "TEST-Sprint-PI-2025-Q1-3"

    @pytest.mark.asyncio
    async def test_get_project_sprints(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting project sprints."""
        client = AsyncMock()
        client.list_boards.return_value = [MagicMock(id=1)]
        client.list_sprints.return_value = [
            Sprint(
                id=1,
                name="Sprint 1",
                state=SprintState.ACTIVE,
                board_id=1,
                start_date=date(2025, 1, 1),
                end_date=date(2025, 1, 14),
            )
        ]

        agile = AgileManager(client, mock_projects_config)
        sprints = await agile.get_project_sprints("TEST")

        assert len(sprints) == 1
        assert sprints[0].name == "Sprint 1"

    @pytest.mark.asyncio
    async def test_get_current_sprint(self, mock_projects_config: ProjectsConfig) -> None:
        """Test getting current sprint."""
        client = AsyncMock()
        client.list_boards.return_value = [MagicMock(id=1)]
        active_sprint = Sprint(
            id=1,
            name="Active Sprint",
            state=SprintState.ACTIVE,
            board_id=1,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 1, 14),
        )
        client.list_sprints.return_value = [active_sprint]

        agile = AgileManager(client, mock_projects_config)
        sprint = await agile.get_current_sprint("TEST")

        assert sprint is not None
        assert sprint.name == "Active Sprint"
        assert sprint.state == SprintState.ACTIVE


class TestAgileManagerVelocity:
    """Tests for velocity calculations."""

    @pytest.mark.asyncio
    async def test_get_sprint_velocity(self, mock_projects_config: ProjectsConfig) -> None:
        """Test calculating sprint velocity."""
        client = AsyncMock()
        client.get_sprint.return_value = Sprint(
            id=1,
            name="Sprint 1",
            state=SprintState.CLOSED,
            board_id=1,
        )
        # Mock issues with story points
        client.search_all_issues_jql.return_value = [
            MagicMock(story_points=5),
            MagicMock(story_points=3),
            MagicMock(story_points=8),
        ]

        agile = AgileManager(client, mock_projects_config)
        velocity = await agile.get_sprint_velocity(1)

        assert velocity == 16  # 5 + 3 + 8

    @pytest.mark.asyncio
    async def test_get_sprint_velocity_no_points(
        self, mock_projects_config: ProjectsConfig
    ) -> None:
        """Test velocity calculation with no story points."""
        client = AsyncMock()
        client.get_sprint.return_value = Sprint(
            id=1,
            name="Sprint 1",
            state=SprintState.CLOSED,
            board_id=1,
        )
        # Mock issues without story points
        client.search_all_issues_jql.return_value = [
            MagicMock(story_points=None),
            MagicMock(story_points=None),
        ]

        agile = AgileManager(client, mock_projects_config)
        velocity = await agile.get_sprint_velocity(1)

        assert velocity == 0
