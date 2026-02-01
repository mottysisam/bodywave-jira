"""
Scrum date calculations for the Bodywave Jira MCP Server.

Calculates Quarters, Program Increments (PIs), and Sprint prefixes
based on calendar dates.

Terminology:
- Quarter: Q1-Q4 (3 months each, calendar-based)
- PI (Program Increment): Monthly (3 per quarter, 12 per year)
- Sprint: Iterative within PI (not time-bound)

Sprint Naming Convention:
    {Quarter}_PI{PINumber}_SPRINT{SprintNumber}

    Examples for December 2025 (Q4, PI3):
    - Q4_PI3_SPRINT1
    - Q4_PI3_SPRINT2

    When January 2026 arrives (Q1, PI1):
    - Q1_PI1_SPRINT1
"""

from datetime import date
from typing import NamedTuple


class ScrumContext(NamedTuple):
    """Current Scrum context based on date."""

    quarter: int  # 1-4
    pi_number: int  # 1-3 (within quarter)
    quarter_label: str  # "Q4"
    pi_label: str  # "PI3"
    sprint_prefix: str  # "Q4_PI3_SPRINT"
    month_name: str  # "December"
    year: int  # 2025


# Month names for display
MONTH_NAMES = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]

# Quarter month ranges for display
QUARTER_RANGES = {
    1: "Jan-Mar",
    2: "Apr-Jun",
    3: "Jul-Sep",
    4: "Oct-Dec",
}


def get_current_quarter(ref_date: date | None = None) -> int:
    """Get current quarter number (1-4).

    Args:
        ref_date: Reference date (defaults to today).

    Returns:
        Quarter number 1-4.

    Examples:
        January-March -> 1
        April-June -> 2
        July-September -> 3
        October-December -> 4
    """
    d = ref_date or date.today()
    return (d.month - 1) // 3 + 1


def get_pi_number(ref_date: date | None = None) -> int:
    """Get PI number within current quarter (1-3).

    Args:
        ref_date: Reference date (defaults to today).

    Returns:
        PI number 1-3 within the quarter.

    Examples:
        January, April, July, October -> 1 (first month of quarter)
        February, May, August, November -> 2 (second month)
        March, June, September, December -> 3 (third month)
    """
    d = ref_date or date.today()
    return ((d.month - 1) % 3) + 1


def get_quarter_label(ref_date: date | None = None) -> str:
    """Get quarter label string.

    Args:
        ref_date: Reference date (defaults to today).

    Returns:
        Quarter label like "Q4".
    """
    return f"Q{get_current_quarter(ref_date)}"


def get_pi_label(ref_date: date | None = None) -> str:
    """Get PI label string.

    Args:
        ref_date: Reference date (defaults to today).

    Returns:
        PI label like "PI3".
    """
    return f"PI{get_pi_number(ref_date)}"


def get_sprint_prefix(ref_date: date | None = None) -> str:
    """Get sprint name prefix for current PI.

    Args:
        ref_date: Reference date (defaults to today).

    Returns:
        Sprint prefix like "Q4_PI3_SPRINT".

    Usage:
        prefix = get_sprint_prefix()  # "Q4_PI3_SPRINT"
        sprint_name = f"{prefix}1"    # "Q4_PI3_SPRINT1"
    """
    d = ref_date or date.today()
    q = get_current_quarter(d)
    pi = get_pi_number(d)
    return f"Q{q}_PI{pi}_SPRINT"


def get_scrum_context(ref_date: date | None = None) -> ScrumContext:
    """Get complete Scrum context for a date.

    Args:
        ref_date: Reference date (defaults to today).

    Returns:
        ScrumContext with all calculated values.

    Example:
        >>> ctx = get_scrum_context(date(2025, 12, 5))
        >>> ctx.quarter
        4
        >>> ctx.pi_number
        3
        >>> ctx.sprint_prefix
        'Q4_PI3_SPRINT'
        >>> ctx.month_name
        'December'
    """
    d = ref_date or date.today()
    quarter = get_current_quarter(d)
    pi_number = get_pi_number(d)

    return ScrumContext(
        quarter=quarter,
        pi_number=pi_number,
        quarter_label=f"Q{quarter}",
        pi_label=f"PI{pi_number}",
        sprint_prefix=f"Q{quarter}_PI{pi_number}_SPRINT",
        month_name=MONTH_NAMES[d.month],
        year=d.year,
    )


def parse_sprint_number(sprint_name: str) -> int | None:
    """Extract sprint number from sprint name.

    Args:
        sprint_name: Sprint name like "Q4_PI3_SPRINT2".

    Returns:
        Sprint number (2 from "Q4_PI3_SPRINT2") or None if invalid.
    """
    # Expected format: Q{N}_PI{N}_SPRINT{N}
    if "_SPRINT" not in sprint_name:
        return None

    try:
        suffix = sprint_name.split("_SPRINT")[-1]
        return int(suffix)
    except (ValueError, IndexError):
        return None


def get_next_sprint_name(
    existing_sprints: list[str],
    ref_date: date | None = None,
) -> str:
    """Calculate next sprint name based on existing sprints.

    Args:
        existing_sprints: List of existing sprint names.
        ref_date: Reference date (defaults to today).

    Returns:
        Next sprint name (e.g., "Q4_PI3_SPRINT3" if SPRINT1 and SPRINT2 exist).
    """
    prefix = get_sprint_prefix(ref_date)

    # Filter sprints matching current prefix
    current_sprints = [s for s in existing_sprints if s.startswith(prefix)]

    if not current_sprints:
        return f"{prefix}1"

    # Find highest sprint number
    max_num = 0
    for name in current_sprints:
        num = parse_sprint_number(name)
        if num and num > max_num:
            max_num = num

    return f"{prefix}{max_num + 1}"


def is_sprint_in_current_pi(
    sprint_name: str,
    ref_date: date | None = None,
) -> bool:
    """Check if a sprint belongs to the current PI.

    Args:
        sprint_name: Sprint name to check.
        ref_date: Reference date (defaults to today).

    Returns:
        True if sprint is in current PI.
    """
    prefix = get_sprint_prefix(ref_date)
    return sprint_name.startswith(prefix)


def format_context_display(ctx: ScrumContext) -> str:
    """Format Scrum context for display.

    Args:
        ctx: ScrumContext to format.

    Returns:
        Formatted string for display.
    """
    return f"""Quarter: {ctx.quarter_label} ({QUARTER_RANGES[ctx.quarter]} {ctx.year})
Program Increment: {ctx.pi_label} ({ctx.month_name})
Sprint Prefix: {ctx.sprint_prefix}"""


# Convenience function for quick testing
if __name__ == "__main__":
    ctx = get_scrum_context()
    print("Current Scrum Context:")
    print("-" * 40)
    print(format_context_display(ctx))
    print("-" * 40)
    print(f"Next sprint would be: {get_next_sprint_name([])}")
