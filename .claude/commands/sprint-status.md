# Sprint Status

Show the current sprint status and progress.

## Instructions

Use the Jira MCP tools to display the current sprint status:

1. First, list the available Jira accounts using `mcp__bodywave-jira__jira_list_accounts`
2. Get the active sprint for the current board using `mcp__bodywave-jira__jira_search_issues` with JQL: `sprint in openSprints() ORDER BY priority DESC`
3. Calculate and display:
   - Sprint name and dates
   - Total issues vs completed
   - Story points progress
   - Issues by status (To Do, In Progress, Done)
   - Days remaining

## Output Format

Present the sprint status in a clear, formatted table:

```
## Sprint: [Sprint Name]
Status: Active | Days Remaining: X

### Progress
| Metric | Value |
|--------|-------|
| Total Issues | X |
| Completed | X |
| In Progress | X |
| To Do | X |
| Completion % | X% |

### Story Points
| Metric | Value |
|--------|-------|
| Committed | X |
| Completed | X |
| Remaining | X |
```

If no active sprint is found, suggest creating or starting one.
