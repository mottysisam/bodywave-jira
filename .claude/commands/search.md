# Search Issues

Search Jira issues using JQL or keywords.

## Arguments

- `$ARGUMENTS` - Required: Search query (JQL or keywords)

## Instructions

Search for issues based on the input:

1. Determine if input is JQL or keywords:
   - If contains operators like `=`, `AND`, `OR`, `IN` → treat as JQL
   - Otherwise → build JQL from keywords

2. For keyword search, build JQL:
   ```
   text ~ "$ARGUMENTS" ORDER BY updated DESC
   ```

3. Use `mcp__bodywave-jira__jira_search_issues` with the JQL

4. Display up to 20 results

## Examples

```
/search authentication
/search project = MGMT AND status = "In Progress"
/search assignee = currentUser() AND updated >= -7d
/search labels = backend
```

## Output Format

```
## Search Results

Query: `text ~ "authentication"`
Found: X issues

| Key | Summary | Status | Updated |
|-----|---------|--------|---------|
| PROJ-123 | Add authentication | In Progress | 2025-01-05 |
| PROJ-456 | Fix auth bug | Done | 2025-01-04 |

---
Showing X of Y results
```

If no results, suggest refining the search query.
