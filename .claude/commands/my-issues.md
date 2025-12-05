# My Issues

Show issues assigned to the current user.

## Arguments

- `$ARGUMENTS` - Optional: project key to filter by (e.g., "MGMT" or "BCM")

## Instructions

Use the Jira MCP tools to display assigned issues:

1. Build JQL query based on arguments:
   - If project key provided: `project = $ARGUMENTS AND assignee = currentUser() AND status != Done ORDER BY priority DESC`
   - Otherwise: `assignee = currentUser() AND status != Done ORDER BY priority DESC`

2. Use `mcp__bodywave-jira__jira_search_issues` to find issues

3. Display results grouped by status

## Output Format

```
## My Active Issues

### In Progress
- [PROJ-123] Issue title (High) - 3 points
- [PROJ-456] Another issue (Medium) - 2 points

### To Do
- [PROJ-789] Pending task (Low) - 1 point

### In Review
- [PROJ-101] Review needed (Medium)

---
Total: X issues | X story points
```

If no issues found, confirm the user has no assigned work.
