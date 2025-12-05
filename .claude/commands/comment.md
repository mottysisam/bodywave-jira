# Add Comment

Add a comment to a Jira issue.

## Arguments

- `$ARGUMENTS` - Required: Issue key and comment in format "PROJ-123 Your comment here"

## Instructions

Parse the arguments and add a comment:

1. Parse input to extract:
   - Issue key (first word, matches pattern like PROJ-123)
   - Comment text (everything after the issue key)

2. Validate the issue exists using `mcp__bodywave-jira__jira_get_issue`

3. Use `mcp__bodywave-jira__jira_add_comment` to add the comment

## Examples

```
/comment MGMT-123 Started working on this feature
/comment BCM-456 Completed code review, looks good!
/comment MGMT-789 Blocked waiting for API specification
```

## Output Format

```
## Comment Added

| Field | Value |
|-------|-------|
| Issue | MGMT-123 |
| Comment | Started working on this feature |
| Added | 2025-01-05 10:30 |
| Author | Current User |

Your comment has been added to [MGMT-123].
```

If comment fails, explain the error.
