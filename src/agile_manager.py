"""
Agile/Scrum management for the Bodywave Jira MCP Server.

Handles Program Increments (PIs), Sprints, and velocity calculations
following SAFe-inspired quarterly planning methodology.
"""

from datetime import date, timedelta
from typing import TYPE_CHECKING

import structlog

from src.config import ProjectConfig, ProjectsConfig
from src.models import Issue, ProgramIncrement, Sprint, SprintState

if TYPE_CHECKING:
    from src.jira_client import JiraClient

logger = structlog.get_logger(__name__)


class AgileManager:
    """Manages Agile/Scrum operations including PI and Sprint management.

    The AgileManager provides:
    - Program Increment (PI) tracking and calculations
    - Sprint date calculations
    - Velocity metrics
    - Sprint lifecycle management

    Usage:
        client = JiraClient(config)
        projects_config = load_projects_config()
        agile = AgileManager(client, projects_config)

        # Get current PI
        pi = agile.get_current_pi()
        print(f"Current PI: {pi.name}")

        # Get sprints for a project
        sprints = await agile.get_project_sprints("BCM")
    """

    # Quarter start months (1-indexed)
    QUARTER_START_MONTHS = {1: 1, 2: 4, 3: 7, 4: 10}

    def __init__(
        self,
        client: "JiraClient",
        projects_config: ProjectsConfig,
    ) -> None:
        """Initialize AgileManager.

        Args:
            client: Jira API client.
            projects_config: Projects configuration.
        """
        self._client = client
        self._projects_config = projects_config
        self._agile_config = projects_config.agile

    # ========================================================================
    # Program Increment (PI) Operations
    # ========================================================================

    def get_current_pi(self, reference_date: date | None = None) -> ProgramIncrement:
        """Get the current Program Increment based on date.

        Args:
            reference_date: Date to check (defaults to today).

        Returns:
            ProgramIncrement for the given date.
        """
        ref = reference_date or date.today()
        year = ref.year
        quarter = (ref.month - 1) // 3 + 1

        return self._create_pi(year, quarter)

    def get_pi_for_date(self, target_date: date) -> ProgramIncrement:
        """Get the PI that contains a specific date.

        Args:
            target_date: Date to find PI for.

        Returns:
            ProgramIncrement containing the date.
        """
        return self.get_current_pi(target_date)

    def get_next_pi(self, current_pi: ProgramIncrement | None = None) -> ProgramIncrement:
        """Get the next Program Increment.

        Args:
            current_pi: Current PI (defaults to current date's PI).

        Returns:
            Next ProgramIncrement.
        """
        if current_pi is None:
            current_pi = self.get_current_pi()

        year = current_pi.year
        quarter = current_pi.quarter + 1

        if quarter > 4:
            year += 1
            quarter = 1

        return self._create_pi(year, quarter)

    def get_previous_pi(self, current_pi: ProgramIncrement | None = None) -> ProgramIncrement:
        """Get the previous Program Increment.

        Args:
            current_pi: Current PI (defaults to current date's PI).

        Returns:
            Previous ProgramIncrement.
        """
        if current_pi is None:
            current_pi = self.get_current_pi()

        year = current_pi.year
        quarter = current_pi.quarter - 1

        if quarter < 1:
            year -= 1
            quarter = 4

        return self._create_pi(year, quarter)

    def get_pis_for_year(self, year: int) -> list[ProgramIncrement]:
        """Get all PIs for a given year.

        Args:
            year: Year to get PIs for.

        Returns:
            List of 4 ProgramIncrements for the year.
        """
        return [self._create_pi(year, q) for q in range(1, 5)]

    def _create_pi(self, year: int, quarter: int) -> ProgramIncrement:
        """Create a ProgramIncrement object.

        Args:
            year: PI year.
            quarter: PI quarter (1-4).

        Returns:
            ProgramIncrement object.
        """
        start_month = self.QUARTER_START_MONTHS[quarter]
        start_date = date(year, start_month, 1)

        # End date is last day of quarter
        if quarter == 4:
            end_date = date(year, 12, 31)
        else:
            end_month = start_month + 3
            end_date = date(year, end_month, 1) - timedelta(days=1)

        name = self._agile_config.pi_naming_pattern.format(
            year=year,
            quarter=quarter,
        )

        return ProgramIncrement(
            name=name,
            year=year,
            quarter=quarter,
            start_date=start_date,
            end_date=end_date,
        )

    # ========================================================================
    # Sprint Operations
    # ========================================================================

    def calculate_sprint_dates(
        self,
        pi: ProgramIncrement,
        sprint_number: int,
        project_config: ProjectConfig,
    ) -> tuple[date, date]:
        """Calculate start and end dates for a sprint within a PI.

        Args:
            pi: Program Increment.
            sprint_number: Sprint number within PI (1-based).
            project_config: Project configuration.

        Returns:
            Tuple of (start_date, end_date).
        """
        duration_weeks = project_config.sprint_duration_weeks
        sprint_duration = timedelta(weeks=duration_weeks)

        # Calculate sprint start date
        sprint_offset = timedelta(weeks=duration_weeks * (sprint_number - 1))
        start_date = pi.start_date + sprint_offset

        # End date is start + duration - 1 day
        end_date = start_date + sprint_duration - timedelta(days=1)

        # Ensure end date doesn't exceed PI end
        if end_date > pi.end_date:
            end_date = pi.end_date

        return start_date, end_date

    def generate_sprint_name(
        self,
        pi: ProgramIncrement,
        sprint_number: int,
        project_config: ProjectConfig,
    ) -> str:
        """Generate a sprint name following naming convention.

        Args:
            pi: Program Increment.
            sprint_number: Sprint number within PI.
            project_config: Project configuration.

        Returns:
            Sprint name string.
        """
        return self._agile_config.sprint_naming_pattern.format(
            project=project_config.key,
            pi=pi.label,
            number=sprint_number,
        )

    async def get_project_sprints(
        self,
        project_key: str,
        state: SprintState | None = None,
    ) -> list[Sprint]:
        """Get all sprints for a project.

        Args:
            project_key: Project key.
            state: Optional filter by sprint state.

        Returns:
            List of Sprint objects.
        """
        project_config = self._projects_config.get_project(project_key)
        if not project_config:
            logger.warning("Project not in config", project_key=project_key)
            return []

        board_id = project_config.board_id
        if not board_id:
            # Try to find board for project
            boards = await self._client.list_boards(project_key)
            if not boards:
                logger.warning("No board found for project", project_key=project_key)
                return []
            board_id = boards[0].id

        state_str = state.value if state else None
        return await self._client.list_sprints(board_id, state=state_str)

    async def get_current_sprint(self, project_key: str) -> Sprint | None:
        """Get the current active sprint for a project.

        Args:
            project_key: Project key.

        Returns:
            Active Sprint or None if no active sprint.
        """
        sprints = await self.get_project_sprints(project_key, state=SprintState.ACTIVE)
        return sprints[0] if sprints else None

    async def get_sprints_for_pi(
        self,
        project_key: str,
        pi: ProgramIncrement,
    ) -> list[Sprint]:
        """Get all sprints that fall within a PI.

        Args:
            project_key: Project key.
            pi: Program Increment.

        Returns:
            List of sprints within the PI date range.
        """
        all_sprints = await self.get_project_sprints(project_key)

        # Filter sprints by date range
        pi_sprints = []
        for sprint in all_sprints:
            if sprint.start_date and sprint.end_date:
                # Sprint is in PI if it overlaps with PI dates
                if sprint.start_date <= pi.end_date and sprint.end_date >= pi.start_date:
                    pi_sprints.append(sprint)
            elif sprint.start_date:
                # Only start date - check if within PI
                if pi.start_date <= sprint.start_date <= pi.end_date:
                    pi_sprints.append(sprint)

        return sorted(pi_sprints, key=lambda s: s.start_date or date.min)

    async def create_pi_sprints(
        self,
        project_key: str,
        pi: ProgramIncrement,
        num_sprints: int | None = None,
    ) -> list[Sprint]:
        """Create all sprints for a PI.

        Args:
            project_key: Project key.
            pi: Program Increment.
            num_sprints: Number of sprints (defaults to project config).

        Returns:
            List of created Sprint objects.
        """
        project_config = self._projects_config.get_project(project_key)
        if not project_config:
            raise ValueError(f"Project '{project_key}' not found in config")

        board_id = project_config.board_id
        if not board_id:
            boards = await self._client.list_boards(project_key)
            if not boards:
                raise ValueError(f"No board found for project '{project_key}'")
            board_id = boards[0].id

        num_sprints = num_sprints or project_config.sprints_per_pi
        created_sprints = []

        for sprint_num in range(1, num_sprints + 1):
            start_date, end_date = self.calculate_sprint_dates(
                pi, sprint_num, project_config
            )
            name = self.generate_sprint_name(pi, sprint_num, project_config)

            sprint = await self._client.create_sprint(
                board_id=board_id,
                name=name,
                start_date=start_date.isoformat(),
                end_date=end_date.isoformat(),
                goal=f"Sprint {sprint_num} of {pi.name}",
            )
            created_sprints.append(sprint)

            logger.info(
                "Created sprint",
                name=name,
                start_date=start_date.isoformat(),
                end_date=end_date.isoformat(),
            )

        return created_sprints

    # ========================================================================
    # Velocity & Metrics
    # ========================================================================

    async def get_sprint_velocity(self, sprint_id: int) -> float:
        """Calculate velocity (completed story points) for a sprint.

        Args:
            sprint_id: Sprint ID.

        Returns:
            Total story points completed in sprint.
        """
        sprint = await self._client.get_sprint(sprint_id)

        # Get completed issues in sprint
        jql = f'sprint = {sprint_id} AND status in ("Done", "Closed")'
        issues = await self._client.search_all_issues_jql(jql)

        velocity = sum(i.story_points or 0 for i in issues)

        logger.info(
            "Calculated sprint velocity",
            sprint_id=sprint_id,
            sprint_name=sprint.name,
            velocity=velocity,
            completed_issues=len(issues),
        )

        return velocity

    async def get_pi_velocity(
        self,
        project_key: str,
        pi: ProgramIncrement,
    ) -> float:
        """Calculate total velocity for all sprints in a PI.

        Args:
            project_key: Project key.
            pi: Program Increment.

        Returns:
            Total story points completed in PI.
        """
        sprints = await self.get_sprints_for_pi(project_key, pi)
        total_velocity = 0.0

        for sprint in sprints:
            if sprint.state == SprintState.CLOSED:
                velocity = await self.get_sprint_velocity(sprint.id)
                total_velocity += velocity

        logger.info(
            "Calculated PI velocity",
            project=project_key,
            pi=pi.name,
            total_velocity=total_velocity,
            closed_sprints=sum(1 for s in sprints if s.state == SprintState.CLOSED),
        )

        return total_velocity

    async def get_average_velocity(
        self,
        project_key: str,
        num_sprints: int = 3,
    ) -> float:
        """Calculate average velocity over recent sprints.

        Args:
            project_key: Project key.
            num_sprints: Number of recent sprints to average.

        Returns:
            Average velocity.
        """
        sprints = await self.get_project_sprints(project_key, state=SprintState.CLOSED)

        # Sort by end date, get most recent
        sprints.sort(key=lambda s: s.end_date or date.min, reverse=True)
        recent_sprints = sprints[:num_sprints]

        if not recent_sprints:
            return 0.0

        velocities = [await self.get_sprint_velocity(s.id) for s in recent_sprints]
        avg_velocity = sum(velocities) / len(velocities)

        logger.info(
            "Calculated average velocity",
            project=project_key,
            num_sprints=len(recent_sprints),
            average=avg_velocity,
        )

        return avg_velocity

    # ========================================================================
    # Issue Queries
    # ========================================================================

    async def get_issues_in_sprint(self, sprint_id: int) -> list[Issue]:
        """Get all issues in a sprint.

        Args:
            sprint_id: Sprint ID.

        Returns:
            List of Issues in the sprint.
        """
        jql = f"sprint = {sprint_id}"
        return await self._client.search_all_issues_jql(jql)

    async def get_issues_in_pi(
        self,
        project_key: str,
        pi: ProgramIncrement,
    ) -> list[Issue]:
        """Get all issues labeled with a PI.

        Args:
            project_key: Project key.
            pi: Program Increment.

        Returns:
            List of Issues in the PI.
        """
        jql = f'project = {project_key} AND labels = "{pi.label}"'
        return await self._client.search_all_issues_jql(jql)

    async def get_unplanned_issues(self, project_key: str) -> list[Issue]:
        """Get issues not assigned to any sprint.

        Args:
            project_key: Project key.

        Returns:
            List of unplanned Issues.
        """
        jql = f"project = {project_key} AND sprint is EMPTY"
        return await self._client.search_all_issues_jql(jql)

    async def get_blocked_issues(self, project_key: str) -> list[Issue]:
        """Get issues that are blocked.

        Args:
            project_key: Project key.

        Returns:
            List of blocked Issues.
        """
        jql = f'project = {project_key} AND labels in ("blocked", "impediment")'
        return await self._client.search_all_issues_jql(jql)

    # ========================================================================
    # Sprint Lifecycle
    # ========================================================================

    async def start_next_sprint(self, project_key: str) -> Sprint | None:
        """Start the next planned sprint.

        Args:
            project_key: Project key.

        Returns:
            Started Sprint or None if no future sprints.
        """
        future_sprints = await self.get_project_sprints(
            project_key, state=SprintState.FUTURE
        )

        if not future_sprints:
            logger.warning("No future sprints to start", project=project_key)
            return None

        # Sort by start date and start the earliest
        future_sprints.sort(key=lambda s: s.start_date or date.max)
        sprint = future_sprints[0]

        if not sprint.start_date or not sprint.end_date:
            logger.error(
                "Sprint missing dates",
                sprint_id=sprint.id,
                sprint_name=sprint.name,
            )
            return None

        started = await self._client.start_sprint(
            sprint_id=sprint.id,
            start_date=sprint.start_date.isoformat(),
            end_date=sprint.end_date.isoformat(),
            goal=sprint.goal,
        )

        logger.info("Started sprint", sprint_id=sprint.id, name=sprint.name)
        return started

    async def close_current_sprint(self, project_key: str) -> Sprint | None:
        """Close the current active sprint.

        Args:
            project_key: Project key.

        Returns:
            Closed Sprint or None if no active sprint.
        """
        current = await self.get_current_sprint(project_key)

        if not current:
            logger.warning("No active sprint to close", project=project_key)
            return None

        closed = await self._client.close_sprint(current.id)
        logger.info("Closed sprint", sprint_id=current.id, name=current.name)

        return closed
