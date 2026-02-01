# Sprint Create

Create a new sprint for a project board.

## Arguments

- `$ARGUMENTS` - Required: Board name and sprint details in format "BOARD_NAME: Sprint Name | Goal (optional)"

## Current Limitation

The current MCP server (`@chinchillaenterprises/mcp-jira` v2.0.0) does NOT support sprint creation. This feature is listed as a "Future Enhancement" in the package roadmap.

## Workaround Instructions

Since automated sprint creation is not available, guide the user to create sprints manually:

1. **Inform the user** about the MCP limitation
2. **Provide direct link** to create sprint in Jira:
   - Bodywave: https://your-domain.atlassian.net/jira/software/projects/{PROJECT_KEY}/boards/{BOARD_ID}/backlog
   - Click "Create Sprint" button in the backlog view

3. **Suggest sprint naming convention**:
   - Format: `{Project}-Sprint-{PI}-{Number}`
   - Example: `CMM-Sprint-PI2025Q1-3`

4. **Recommend sprint settings**:
   - Duration: 2 weeks (standard)
   - Include a sprint goal
   - Set start/end dates

## Output Format

```
## Sprint Creation - Manual Required

The MCP server does not currently support automated sprint creation.

### Create Sprint Manually

1. Go to your project backlog:
   https://your-domain.atlassian.net/jira/software/projects/{PROJECT}/boards

2. Click "Create Sprint" in the backlog view

3. Configure the sprint:
   - **Name**: {Suggested Name}
   - **Goal**: {Goal if provided}
   - **Duration**: 2 weeks (recommended)

### Suggested Sprint Name

Based on your input: `{PROJECT}-Sprint-{Current Quarter}-{Next Number}`

---
Note: Sprint management is planned for a future version of the MCP server.
See MGMT-15 for tracking this feature request.
```

## Example Usage

```
/sprint-create CMM: Sprint 5 | Complete booking flow
/sprint-create BNN: January Sprint
```
