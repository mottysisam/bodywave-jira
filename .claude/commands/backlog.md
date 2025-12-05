# Backlog

Show the product backlog for a project.

## Arguments

- `$ARGUMENTS` - Required: Project key (e.g., "MGMT", "BCM")

## Instructions

Use the Jira MCP tools to display the backlog:

1. Validate project key is provided in `$ARGUMENTS`

2. Use `mcp__bodywave-jira__jira_search_issues` with JQL:
   ```
   project = $ARGUMENTS AND sprint is EMPTY AND status != Done ORDER BY priority DESC, created DESC
   ```

3. Group issues by priority and display

## Output Format

```
## Backlog: $ARGUMENTS

### High Priority (X issues)
| Key | Summary | Type | Created |
|-----|---------|------|---------|
| PROJ-123 | Issue title | Story | 2025-01-01 |

### Medium Priority (X issues)
| Key | Summary | Type | Created |
|-----|---------|------|---------|
| PROJ-456 | Another issue | Task | 2025-01-02 |

### Low Priority (X issues)
| Key | Summary | Type | Created |
|-----|---------|------|---------|
| PROJ-789 | Low priority item | Task | 2025-01-03 |

---
Total backlog items: X
```

If no backlog items, confirm the backlog is empty.
