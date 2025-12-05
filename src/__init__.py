"""
Bodywave Jira MCP Server

A Master Control Program (MCP) server that enables AI agents to manage
Jira Cloud spaces for Bodywave.

Main components:
- JiraClient: REST API client for Jira Cloud
- AgileManager: PI and Sprint management
- MCPOrchestrator: MCP server for AI agent integration
"""

from src.jira_client import JiraClient
from src.agile_manager import AgileManager
from src.mcp_orchestrator import MCPOrchestrator
from src.config import Config, load_config
from src.models import Issue, Project, Sprint, ProgramIncrement

__version__ = "0.1.0"
__all__ = [
    "JiraClient",
    "AgileManager",
    "MCPOrchestrator",
    "Config",
    "load_config",
    "Issue",
    "Project",
    "Sprint",
    "ProgramIncrement",
]
