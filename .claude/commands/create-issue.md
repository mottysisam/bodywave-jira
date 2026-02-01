# Create Issue

Create a new Jira issue.

## Arguments

- `$ARGUMENTS` - Required: Issue details in format "PROJECT: Summary" or "PROJECT: Summary | Description"

## Instructions

Parse the arguments and create a new Jira issue:

1. Parse the input:
   - Extract project key (before the colon)
   - Extract summary (after colon, before pipe if present)
   - Extract description (after pipe if present)

2. Determine issue type:
   - If summary contains "bug" or "fix" → Bug
   - If summary contains "feature" or "add" → Story
   - Default → Task

3. Use `mcp__bodywave-jira__jira_create_issue` with:
   - project_key: extracted project
   - summary: extracted summary
   - description: extracted description (if any)
   - issue_type: determined type

4. Display the created issue details

## Examples

```
/create-issue MGMT: Add user authentication
/create-issue BCM: Fix login bug | Users cannot log in on mobile
/create-issue MGMT: Refactor database layer | Need to improve query performance
```

## Output Format

```
## Issue Created Successfully

| Field | Value |
|-------|-------|
| Key | PROJ-123 |
| Type | Task |
| Summary | Add user authentication |
| Status | To Do |
| Link | https://your-domain.atlassian.net/browse/PROJ-123 |
```
