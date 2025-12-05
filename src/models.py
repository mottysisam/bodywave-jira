"""
Data models for the Bodywave Jira MCP Server.

All models are Pydantic BaseModels for validation and serialization.
"""

from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, ConfigDict


class IssueType(str, Enum):
    """Jira issue types."""

    EPIC = "Epic"
    STORY = "Story"
    TASK = "Task"
    SUBTASK = "Sub-task"
    BUG = "Bug"


class Priority(str, Enum):
    """Jira issue priorities."""

    HIGHEST = "Highest"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"
    LOWEST = "Lowest"


class IssueStatus(str, Enum):
    """Common Jira issue statuses."""

    TODO = "To Do"
    IN_PROGRESS = "In Progress"
    IN_REVIEW = "In Review"
    DONE = "Done"


class SprintState(str, Enum):
    """Sprint states in Jira."""

    FUTURE = "future"
    ACTIVE = "active"
    CLOSED = "closed"


class User(BaseModel):
    """Jira user representation."""

    model_config = ConfigDict(extra="ignore")

    account_id: str = Field(..., description="Atlassian account ID")
    display_name: str = Field(..., description="User display name")
    email_address: str | None = Field(None, description="User email")
    active: bool = Field(True, description="Is user active")
    avatar_url: str | None = Field(None, alias="avatarUrls")

    @classmethod
    def from_jira_response(cls, data: dict[str, Any]) -> "User":
        """Create User from Jira API response."""
        avatar = data.get("avatarUrls", {})
        return cls(
            account_id=data["accountId"],
            display_name=data.get("displayName", "Unknown"),
            email_address=data.get("emailAddress"),
            active=data.get("active", True),
            avatar_url=avatar.get("48x48") if avatar else None,
        )


class Issue(BaseModel):
    """Jira issue representation."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Issue ID")
    key: str = Field(..., description="Issue key (e.g., BCM-123)")
    summary: str = Field(..., description="Issue summary")
    description: str | None = Field(None, description="Issue description")
    issue_type: str = Field(..., description="Issue type name")
    status: str = Field(..., description="Current status")
    priority: str | None = Field(None, description="Issue priority")
    project_key: str = Field(..., description="Project key")
    assignee: User | None = Field(None, description="Assigned user")
    reporter: User | None = Field(None, description="Reporter user")
    labels: list[str] = Field(default_factory=list, description="Issue labels")
    sprint_id: int | None = Field(None, description="Current sprint ID")
    created: datetime = Field(..., description="Creation timestamp")
    updated: datetime = Field(..., description="Last update timestamp")
    story_points: float | None = Field(None, description="Story points estimate")

    @classmethod
    def from_jira_response(cls, data: dict[str, Any]) -> "Issue":
        """Create Issue from Jira API response."""
        fields = data.get("fields", {})

        assignee = None
        if fields.get("assignee"):
            assignee = User.from_jira_response(fields["assignee"])

        reporter = None
        if fields.get("reporter"):
            reporter = User.from_jira_response(fields["reporter"])

        # Extract sprint ID from sprint field (Jira Agile)
        sprint_id = None
        sprint_field = fields.get("sprint")
        if sprint_field and isinstance(sprint_field, dict):
            sprint_id = sprint_field.get("id")

        # Story points can be in different custom fields
        story_points = fields.get("storyPoints") or fields.get("customfield_10016")

        return cls(
            id=data["id"],
            key=data["key"],
            summary=fields.get("summary", ""),
            description=fields.get("description"),
            issue_type=fields.get("issuetype", {}).get("name", "Unknown"),
            status=fields.get("status", {}).get("name", "Unknown"),
            priority=fields.get("priority", {}).get("name") if fields.get("priority") else None,
            project_key=fields.get("project", {}).get("key", ""),
            assignee=assignee,
            reporter=reporter,
            labels=fields.get("labels", []),
            sprint_id=sprint_id,
            created=datetime.fromisoformat(fields["created"].replace("Z", "+00:00")),
            updated=datetime.fromisoformat(fields["updated"].replace("Z", "+00:00")),
            story_points=story_points,
        )


class Project(BaseModel):
    """Jira project representation."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Project ID")
    key: str = Field(..., description="Project key")
    name: str = Field(..., description="Project name")
    description: str | None = Field(None, description="Project description")
    lead: User | None = Field(None, description="Project lead")
    project_type: str = Field(..., description="Project type key")
    style: str | None = Field(None, description="Project style")

    @classmethod
    def from_jira_response(cls, data: dict[str, Any]) -> "Project":
        """Create Project from Jira API response."""
        lead = None
        if data.get("lead"):
            lead = User.from_jira_response(data["lead"])

        return cls(
            id=data["id"],
            key=data["key"],
            name=data["name"],
            description=data.get("description"),
            lead=lead,
            project_type=data.get("projectTypeKey", "software"),
            style=data.get("style"),
        )


class ProjectCreate(BaseModel):
    """Schema for creating a new project."""

    key: str = Field(..., min_length=2, max_length=10, description="Project key (uppercase, 2-10 chars)")
    name: str = Field(..., min_length=1, max_length=255, description="Project name")
    project_type: str = Field(default="software", description="Project type: software, business, service_desk")
    description: str | None = Field(None, description="Project description")
    lead_account_id: str | None = Field(None, description="Project lead account ID")
    template_key: str | None = Field(None, description="Project template key")

    def to_jira_payload(self) -> dict[str, Any]:
        """Convert to Jira API payload."""
        payload: dict[str, Any] = {
            "key": self.key.upper(),
            "name": self.name,
            "projectTypeKey": self.project_type,
        }

        if self.description:
            payload["description"] = self.description

        if self.lead_account_id:
            payload["leadAccountId"] = self.lead_account_id

        if self.template_key:
            payload["projectTemplateKey"] = self.template_key

        return payload


class Sprint(BaseModel):
    """Jira sprint representation."""

    model_config = ConfigDict(extra="ignore")

    id: int = Field(..., description="Sprint ID")
    name: str = Field(..., description="Sprint name")
    state: SprintState = Field(..., description="Sprint state")
    start_date: date | None = Field(None, description="Sprint start date")
    end_date: date | None = Field(None, description="Sprint end date")
    complete_date: date | None = Field(None, description="Sprint completion date")
    board_id: int = Field(..., description="Associated board ID")
    goal: str | None = Field(None, description="Sprint goal")

    @classmethod
    def from_jira_response(cls, data: dict[str, Any]) -> "Sprint":
        """Create Sprint from Jira API response."""

        def parse_date(date_str: str | None) -> date | None:
            if not date_str:
                return None
            # Handle both date and datetime formats
            if "T" in date_str:
                return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
            return date.fromisoformat(date_str)

        return cls(
            id=data["id"],
            name=data["name"],
            state=SprintState(data.get("state", "future")),
            start_date=parse_date(data.get("startDate")),
            end_date=parse_date(data.get("endDate")),
            complete_date=parse_date(data.get("completeDate")),
            board_id=data.get("originBoardId", 0),
            goal=data.get("goal"),
        )


class Board(BaseModel):
    """Jira board representation."""

    model_config = ConfigDict(extra="ignore")

    id: int = Field(..., description="Board ID")
    name: str = Field(..., description="Board name")
    board_type: str = Field(..., description="Board type (scrum, kanban)")
    project_key: str | None = Field(None, description="Associated project key")

    @classmethod
    def from_jira_response(cls, data: dict[str, Any]) -> "Board":
        """Create Board from Jira API response."""
        location = data.get("location", {})
        return cls(
            id=data["id"],
            name=data["name"],
            board_type=data.get("type", "scrum"),
            project_key=location.get("projectKey"),
        )


class ProgramIncrement(BaseModel):
    """Program Increment (PI) representation.

    PIs are quarterly planning periods used in SAFe methodology.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., description="PI name (e.g., PI-2025-Q1)")
    year: int = Field(..., description="PI year")
    quarter: int = Field(..., ge=1, le=4, description="PI quarter (1-4)")
    start_date: date = Field(..., description="PI start date")
    end_date: date = Field(..., description="PI end date")
    sprints: list[Sprint] = Field(default_factory=list, description="Sprints in this PI")

    @property
    def is_current(self) -> bool:
        """Check if this PI is currently active."""
        today = date.today()
        return self.start_date <= today <= self.end_date

    @property
    def label(self) -> str:
        """Get the PI label for Jira."""
        return f"PI-{self.year}-Q{self.quarter}"


class IssueCreate(BaseModel):
    """Schema for creating a new issue."""

    project_key: str = Field(..., description="Project key")
    summary: str = Field(..., min_length=1, max_length=255, description="Issue summary")
    description: str | None = Field(None, description="Issue description")
    issue_type: str = Field(default="Task", description="Issue type")
    priority: str | None = Field(None, description="Issue priority")
    assignee_id: str | None = Field(None, description="Assignee account ID")
    labels: list[str] = Field(default_factory=list, description="Issue labels")
    sprint_id: int | None = Field(None, description="Sprint ID")
    parent_key: str | None = Field(None, description="Parent issue key (for subtasks)")
    story_points: float | None = Field(None, description="Story points")

    def to_jira_payload(self) -> dict[str, Any]:
        """Convert to Jira API payload."""
        fields: dict[str, Any] = {
            "project": {"key": self.project_key},
            "summary": self.summary,
            "issuetype": {"name": self.issue_type},
        }

        if self.description:
            # Jira Cloud uses Atlassian Document Format (ADF)
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": self.description}],
                    }
                ],
            }

        if self.priority:
            fields["priority"] = {"name": self.priority}

        if self.assignee_id:
            fields["assignee"] = {"accountId": self.assignee_id}

        if self.labels:
            fields["labels"] = self.labels

        if self.parent_key:
            fields["parent"] = {"key": self.parent_key}

        return {"fields": fields}


class IssueUpdate(BaseModel):
    """Schema for updating an issue."""

    summary: str | None = Field(None, description="New summary")
    description: str | None = Field(None, description="New description")
    priority: str | None = Field(None, description="New priority")
    assignee_id: str | None = Field(None, description="New assignee account ID")
    labels: list[str] | None = Field(None, description="New labels")
    status: str | None = Field(None, description="New status (requires transition)")
    story_points: float | None = Field(None, description="Story points")

    def to_jira_payload(self) -> dict[str, Any]:
        """Convert to Jira API payload."""
        fields: dict[str, Any] = {}

        if self.summary:
            fields["summary"] = self.summary

        if self.description:
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": self.description}],
                    }
                ],
            }

        if self.priority:
            fields["priority"] = {"name": self.priority}

        if self.assignee_id is not None:
            fields["assignee"] = {"accountId": self.assignee_id} if self.assignee_id else None

        if self.labels is not None:
            fields["labels"] = self.labels

        return {"fields": fields}


class SprintCreate(BaseModel):
    """Schema for creating a new sprint."""

    name: str = Field(..., description="Sprint name")
    board_id: int = Field(..., description="Board ID")
    start_date: date | None = Field(None, description="Sprint start date")
    end_date: date | None = Field(None, description="Sprint end date")
    goal: str | None = Field(None, description="Sprint goal")

    def to_jira_payload(self) -> dict[str, Any]:
        """Convert to Jira API payload."""
        payload: dict[str, Any] = {
            "name": self.name,
            "originBoardId": self.board_id,
        }

        if self.start_date:
            payload["startDate"] = self.start_date.isoformat()

        if self.end_date:
            payload["endDate"] = self.end_date.isoformat()

        if self.goal:
            payload["goal"] = self.goal

        return payload


class SearchResult(BaseModel):
    """Search result container."""

    issues: list[Issue] = Field(default_factory=list, description="Found issues")
    total: int = Field(0, description="Total matching issues")
    start_at: int = Field(0, description="Start index")
    max_results: int = Field(50, description="Maximum results per page")

    @property
    def has_more(self) -> bool:
        """Check if there are more results."""
        return self.start_at + len(self.issues) < self.total
