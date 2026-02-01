"""
Multi-account management for Jira MCP Server.

Supports multiple Jira Cloud sites with different OAuth tokens.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ACCOUNTS_FILE = Path(__file__).parent.parent / ".jira_accounts.json"


@dataclass
class JiraAccount:
    """Represents a Jira Cloud account/site."""

    name: str  # Display name (e.g., "bodywave", "brainsway")
    cloud_id: str
    site_url: str  # e.g., "https://your-domain.atlassian.net"
    access_token: str
    refresh_token: str | None
    token_type: str = "Bearer"
    scope: str = ""
    is_default: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "JiraAccount":
        """Create from dictionary."""
        return cls(
            name=data["name"],
            cloud_id=data["cloud_id"],
            site_url=data["site_url"],
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            token_type=data.get("token_type", "Bearer"),
            scope=data.get("scope", ""),
            is_default=data.get("is_default", False),
        )


class AccountManager:
    """Manages multiple Jira accounts."""

    def __init__(self) -> None:
        self._accounts: dict[str, JiraAccount] = {}
        self._load()

    def _load(self) -> None:
        """Load accounts from file."""
        if not ACCOUNTS_FILE.exists():
            # Try to migrate from old single-account file
            self._migrate_from_old_format()
            return

        try:
            data = json.loads(ACCOUNTS_FILE.read_text())
            for name, account_data in data.get("accounts", {}).items():
                self._accounts[name] = JiraAccount.from_dict(account_data)
        except Exception:
            self._accounts = {}

    def _migrate_from_old_format(self) -> None:
        """Migrate from old .oauth_tokens.json format."""
        old_file = Path(__file__).parent.parent / ".oauth_tokens.json"
        if not old_file.exists():
            return

        try:
            data = json.loads(old_file.read_text())
            # Create account from old format
            account = JiraAccount(
                name="default",
                cloud_id=data.get("cloud_id", ""),
                site_url="",  # Will be determined from cloud_id
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token"),
                token_type=data.get("token_type", "Bearer"),
                scope=data.get("scope", ""),
                is_default=True,
            )
            self._accounts["default"] = account
            self._save()
        except Exception:
            pass

    def _save(self) -> None:
        """Save accounts to file."""
        data = {"accounts": {name: acc.to_dict() for name, acc in self._accounts.items()}}
        ACCOUNTS_FILE.write_text(json.dumps(data, indent=2))

    def add_account(
        self,
        name: str,
        cloud_id: str,
        site_url: str,
        access_token: str,
        refresh_token: str | None = None,
        token_type: str = "Bearer",
        scope: str = "",
        set_default: bool = False,
    ) -> JiraAccount:
        """Add or update an account."""
        # If this is the first account or set_default, make it default
        is_default = set_default or len(self._accounts) == 0

        # If setting as default, unset others
        if is_default:
            for acc in self._accounts.values():
                acc.is_default = False

        account = JiraAccount(
            name=name,
            cloud_id=cloud_id,
            site_url=site_url,
            access_token=access_token,
            refresh_token=refresh_token,
            token_type=token_type,
            scope=scope,
            is_default=is_default,
        )

        self._accounts[name] = account
        self._save()
        return account

    def remove_account(self, name: str) -> bool:
        """Remove an account."""
        if name in self._accounts:
            was_default = self._accounts[name].is_default
            del self._accounts[name]

            # If removed account was default, set first remaining as default
            if was_default and self._accounts:
                first = next(iter(self._accounts.values()))
                first.is_default = True

            self._save()
            return True
        return False

    def get_account(self, name: str) -> JiraAccount | None:
        """Get account by name."""
        return self._accounts.get(name)

    def get_default_account(self) -> JiraAccount | None:
        """Get the default account."""
        for account in self._accounts.values():
            if account.is_default:
                return account
        # Return first account if no default set
        if self._accounts:
            return next(iter(self._accounts.values()))
        return None

    def set_default(self, name: str) -> bool:
        """Set an account as default."""
        if name not in self._accounts:
            return False

        for acc_name, acc in self._accounts.items():
            acc.is_default = acc_name == name

        self._save()
        return True

    def list_accounts(self) -> list[JiraAccount]:
        """List all accounts."""
        return list(self._accounts.values())

    def update_tokens(
        self,
        name: str,
        access_token: str,
        refresh_token: str | None = None,
    ) -> bool:
        """Update tokens for an account."""
        if name not in self._accounts:
            return False

        self._accounts[name].access_token = access_token
        if refresh_token:
            self._accounts[name].refresh_token = refresh_token

        self._save()
        return True


# Global account manager instance
account_manager = AccountManager()
