"""
Configuration management for the Bodywave Jira MCP Server.

Supports loading from environment variables and JSON files.
"""

import json
import os
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.exceptions import ConfigurationError


class Config(BaseSettings):
    """Application configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Jira connection settings
    jira_base_url: str = Field(
        ...,
        alias="JIRA_BASE_URL",
        description="Jira Cloud base URL",
    )
    jira_user_email: str | None = Field(
        default=None,
        alias="JIRA_USER_EMAIL",
        description="User email for Basic Auth (required for Agile API)",
    )
    jira_api_token: str | None = Field(
        default=None,
        alias="JIRA_API_TOKEN",
        description="API token for Basic Auth (required for Agile API)",
    )

    # Optional settings
    log_level: str = Field(
        default="INFO",
        alias="LOG_LEVEL",
        description="Logging level",
    )
    jira_timeout: int = Field(
        default=30,
        alias="JIRA_TIMEOUT",
        description="Request timeout in seconds",
    )
    jira_rate_limit: int = Field(
        default=100,
        alias="JIRA_RATE_LIMIT",
        description="Max requests per minute",
    )

    # OAuth 2.0 (future use)
    jira_oauth_client_id: str | None = Field(
        default=None,
        alias="JIRA_OAUTH_CLIENT_ID",
    )
    jira_oauth_client_secret: str | None = Field(
        default=None,
        alias="JIRA_OAUTH_CLIENT_SECRET",
    )
    jira_oauth_redirect_uri: str | None = Field(
        default=None,
        alias="JIRA_OAUTH_REDIRECT_URI",
    )

    @field_validator("jira_base_url")
    @classmethod
    def validate_base_url(cls, v: str) -> str:
        """Ensure base URL is properly formatted."""
        v = v.rstrip("/")
        if not v.startswith("https://"):
            raise ValueError("Jira URL must use HTTPS")
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Ensure valid log level."""
        valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"Log level must be one of: {valid_levels}")
        return v

    @property
    def api_v3_url(self) -> str:
        """Get the REST API v3 base URL."""
        return f"{self.jira_base_url}/rest/api/3"

    @property
    def agile_api_url(self) -> str:
        """Get the Agile REST API base URL."""
        return f"{self.jira_base_url}/rest/agile/1.0"


class ProjectConfig:
    """Project-specific configuration loaded from JSON."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.key: str = data["key"]
        self.name: str = data["name"]
        self.description: str | None = data.get("description")
        self.board_id: int | None = data.get("board_id")
        self.sprint_duration_weeks: int = data.get("sprint_duration_weeks", 2)
        self.sprints_per_pi: int = data.get("sprints_per_pi", 6)
        self.default_issue_type: str = data.get("default_issue_type", "Task")
        self.workflow: dict[str, Any] = data.get("workflow", {})
        self.labels: dict[str, str] = data.get("labels", {})


class AgileConfig:
    """Agile configuration loaded from JSON."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.pi_duration_months: int = data.get("pi_duration_months", 3)
        self.pis_per_year: int = data.get("pis_per_year", 4)
        self.pi_naming_pattern: str = data.get("pi_naming_pattern", "PI-{year}-Q{quarter}")
        self.sprint_naming_pattern: str = data.get(
            "sprint_naming_pattern", "{project}-Sprint-{pi}-{number}"
        )
        self.default_sprint_duration_weeks: int = data.get("default_sprint_duration_weeks", 2)
        self.default_sprints_per_pi: int = data.get("default_sprints_per_pi", 6)


class ProjectsConfig:
    """Full projects configuration from JSON file."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.version: str = data.get("version", "1.0.0")
        self.organization: dict[str, str] = data.get("organization", {})
        self.agile: AgileConfig = AgileConfig(data.get("agile", {}))
        self.projects: list[ProjectConfig] = [
            ProjectConfig(p) for p in data.get("projects", [])
        ]
        self.issue_types: dict[str, str] = data.get("issue_types", {})
        self.priorities: dict[str, str] = data.get("priorities", {})

    def get_project(self, key: str) -> ProjectConfig | None:
        """Get project configuration by key."""
        for project in self.projects:
            if project.key == key:
                return project
        return None

    @property
    def project_keys(self) -> list[str]:
        """Get all project keys."""
        return [p.key for p in self.projects]


def load_config() -> Config:
    """Load configuration from environment variables.

    Returns:
        Config object with all settings.

    Raises:
        ConfigurationError: If required settings are missing.
    """
    try:
        return Config()  # type: ignore[call-arg]
    except Exception as e:
        raise ConfigurationError(f"Failed to load configuration: {e}") from e


def load_projects_config(config_path: str | Path | None = None) -> ProjectsConfig:
    """Load projects configuration from JSON file.

    Args:
        config_path: Path to config file. Defaults to config/projects.json.

    Returns:
        ProjectsConfig object.

    Raises:
        ConfigurationError: If file is missing or invalid.
    """
    if config_path is None:
        # Default to config/projects.json relative to project root
        config_path = Path(__file__).parent.parent / "config" / "projects.json"
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        raise ConfigurationError(f"Config file not found: {config_path}")

    try:
        with open(config_path) as f:
            data = json.load(f)
        return ProjectsConfig(data)
    except json.JSONDecodeError as e:
        raise ConfigurationError(f"Invalid JSON in config file: {e}") from e
    except Exception as e:
        raise ConfigurationError(f"Failed to load projects config: {e}") from e


def get_env_or_raise(name: str) -> str:
    """Get environment variable or raise error.

    Args:
        name: Environment variable name.

    Returns:
        Environment variable value.

    Raises:
        ConfigurationError: If variable is not set.
    """
    value = os.getenv(name)
    if not value:
        raise ConfigurationError(f"Required environment variable '{name}' is not set")
    return value
