# Transition Issue

Move a Jira issue to a new status.

## Arguments

- `$ARGUMENTS` - Required: Issue key and status in format "PROJ-123 In Progress" or "PROJ-123 Done"

## Instructions

Parse the arguments and transition the issue:

1. Parse input to extract:
   - Issue key (first word, matches pattern like PROJ-123)
   - Target status (remaining words)

2. Validate the issue exists using `mcp__bodywave-jira__jira_get_issue`

3. Common status values:
   - "To Do" or "todo" → To Do
   - "In Progress" or "wip" or "working" → In Progress
   - "In Review" or "review" → In Review
   - "Done" or "complete" or "finished" → Done

4. Add a comment to the issue documenting the transition

## Examples

```
/transition-issue MGMT-123 In Progress
/transition-issue BCM-456 Done
/transition-issue MGMT-789 review
```

## Output Format

```
## Issue Transitioned

| Field | Value |
|-------|-------|
| Issue | MGMT-123 |
| From | To Do |
| To | In Progress |
| Updated | 2025-01-05 10:30 |

The issue has been moved to **In Progress**.
```

If transition fails, explain why (e.g., invalid status, workflow restriction).
