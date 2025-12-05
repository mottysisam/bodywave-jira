# Daily Standup

Generate a standup report based on recent activity.

## Arguments

- `$ARGUMENTS` - Optional: Project key to filter by

## Instructions

Generate a standup report by querying recent activity:

1. Build queries for three categories:

   **Yesterday (completed):**
   ```
   assignee = currentUser() AND status changed TO Done DURING (-1d, now()) ORDER BY updated DESC
   ```

   **Today (in progress):**
   ```
   assignee = currentUser() AND status = "In Progress" ORDER BY priority DESC
   ```

   **Blockers:**
   ```
   assignee = currentUser() AND labels = blocked ORDER BY priority DESC
   ```

2. Use `mcp__bodywave-jira__jira_search_issues` for each query

3. Format as standup report

## Output Format

```
## Daily Standup Report
Date: January 5, 2025

### What I Completed Yesterday
- [PROJ-123] Implemented authentication - Done
- [PROJ-456] Fixed login bug - Done

### What I'm Working On Today
- [PROJ-789] Add user registration (In Progress)
- [PROJ-101] Update API documentation (In Progress)

### Blockers / Impediments
- [PROJ-202] Waiting for design review
  - Blocked since: January 3, 2025
  - Reason: Design team reviewing mockups

---
Sprint Progress: 5/12 issues completed (42%)
```

If no blockers, indicate "No blockers reported".
