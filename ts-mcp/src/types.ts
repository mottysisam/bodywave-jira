/**
 * TypeScript types for Bodywave Jira MCP Server
 */

// Environment configuration (read from env vars)
export interface JiraConfig {
  url: string;        // JIRA_URL - e.g., https://bodywave.atlassian.net
  email: string;      // JIRA_EMAIL - user email for auth
  apiKey: string;     // JIRA_API_KEY - API token
}

// Enums
export enum IssueType {
  EPIC = "Epic",
  STORY = "Story",
  TASK = "Task",
  SUBTASK = "Sub-task",
  BUG = "Bug",
}

export enum Priority {
  HIGHEST = "Highest",
  HIGH = "High",
  MEDIUM = "Medium",
  LOW = "Low",
  LOWEST = "Lowest",
}

export enum IssueStatus {
  TODO = "To Do",
  IN_PROGRESS = "In Progress",
  IN_REVIEW = "In Review",
  DONE = "Done",
}

export enum SprintState {
  FUTURE = "future",
  ACTIVE = "active",
  CLOSED = "closed",
}

export enum ProjectTypeKey {
  SOFTWARE = "software",
  BUSINESS = "business",
  SERVICE_DESK = "service_desk",
}

export enum ProjectTemplate {
  SCRUM = "com.pyxis.greenhopper.jira:gh-simplified-agility-scrum",
  KANBAN = "com.pyxis.greenhopper.jira:gh-simplified-agility-kanban",
  BASIC = "com.pyxis.greenhopper.jira:gh-simplified-basic",
  SCRUM_CLASSIC = "com.pyxis.greenhopper.jira:gh-simplified-scrum-classic",
  KANBAN_CLASSIC = "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic",
}

// User model
export interface User {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
  avatarUrl?: string;
}

// Issue model
export interface Issue {
  id: string;
  key: string;
  summary: string;
  description?: string;
  issueType: string;
  status: string;
  priority?: string;
  projectKey: string;
  assignee?: User;
  reporter?: User;
  labels: string[];
  sprintId?: number;
  created: string;
  updated: string;
  storyPoints?: number;
}

// Project model
export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: User;
  projectType: string;
  style?: string;
}

// Sprint model
export interface Sprint {
  id: number;
  name: string;
  state: SprintState;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  boardId: number;
  goal?: string;
}

// Board model
export interface Board {
  id: number;
  name: string;
  boardType: string;
  projectKey?: string;
}

// Search result
export interface SearchResult {
  issues: Issue[];
  total: number;
  startAt: number;
  maxResults: number;
  nextPageToken?: string;
  isLast?: boolean;
}

// Create/Update schemas
export interface ProjectCreate {
  key: string;
  name: string;
  description?: string;
  leadAccountId?: string;
  projectTypeKey?: ProjectTypeKey;
  projectTemplateKey?: ProjectTemplate;
}

export interface IssueCreate {
  projectKey: string;
  summary: string;
  description?: string;
  issueType?: string;
  priority?: string;
  assigneeId?: string;
  labels?: string[];
  sprintId?: number;
  parentKey?: string;
  storyPoints?: number;
}

export interface IssueUpdate {
  summary?: string;
  description?: string;
  priority?: string;
  assigneeId?: string;
  labels?: string[];
  status?: string;
  storyPoints?: number;
  parentKey?: string;
}

export interface SprintCreate {
  name: string;
  boardId: number;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface SprintUpdate {
  name?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
  state?: SprintState;
}

// Jira API response types
export interface JiraApiError {
  errorMessages: string[];
  errors: Record<string, string>;
}

// Comment model
export interface Comment {
  id: string;
  body: string;
  author: User;
  created: string;
  updated: string;
}

// Transition model
export interface Transition {
  id: string;
  name: string;
  to: {
    id: string;
    name: string;
  };
}

// Field Configuration models
export interface FieldMeta {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue: boolean;
  operations: string[];
  allowedValues?: Array<{ id: string; name: string; value?: string }>;
  schema?: {
    type: string;
    custom?: string;
    customId?: number;
  };
}

export interface CreateMeta {
  projects: Array<{
    id: string;
    key: string;
    name: string;
    issuetypes: Array<{
      id: string;
      name: string;
      fields: Record<string, FieldMeta>;
    }>;
  }>;
}

export interface FieldConfiguration {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
}

export interface FieldConfigurationItem {
  id: string;
  description?: string;
  isHidden: boolean;
  isRequired: boolean;
}

// Custom Field models
export interface CustomField {
  id: string;
  key: string;
  name: string;
  description?: string;
  type: string;
  custom: boolean;
  schema?: {
    type: string;
    custom?: string;
    customId?: number;
    items?: string;
  };
  searchable: boolean;
  navigable: boolean;
}

export interface CustomFieldOption {
  id: string;
  value: string;
  disabled?: boolean;
}

export interface CustomFieldContext {
  id: string;
  name: string;
  isGlobalContext: boolean;
  isAnyIssueType: boolean;
}

// Time Tracking models
export interface Worklog {
  id: string;
  issueId: string;
  author: User;
  updateAuthor?: User;
  comment?: string;
  started: string;
  timeSpent: string;
  timeSpentSeconds: number;
  created: string;
  updated: string;
}

export interface WorklogCreate {
  timeSpent?: string;        // e.g., "3h 30m"
  timeSpentSeconds?: number;
  started?: string;          // ISO date string
  comment?: string;
}

export interface TimeTracking {
  originalEstimate?: string;
  remainingEstimate?: string;
  timeSpent?: string;
  originalEstimateSeconds?: number;
  remainingEstimateSeconds?: number;
  timeSpentSeconds?: number;
}

// Attachment models
export interface Attachment {
  id: string;
  filename: string;
  author: User;
  created: string;
  size: number;
  mimeType: string;
  content: string; // URL to download the attachment
  thumbnail?: string; // URL to thumbnail (for images)
}

// Webhook models
export interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string[];
  filters?: WebhookFilter;
  enabled: boolean;
  self?: string;
  lastUpdatedUser?: User;
  lastUpdatedDisplayName?: string;
  lastUpdated?: number;
}

export interface WebhookFilter {
  issueRelatedEventsSection?: string; // JQL filter
}

export interface WebhookCreate {
  name: string;
  url: string;
  events: string[];
  filters?: WebhookFilter;
  excludeBody?: boolean;
}

// Issue Link models
export interface IssueLink {
  id: string;
  type: IssueLinkType;
  inwardIssue?: LinkedIssue;
  outwardIssue?: LinkedIssue;
  self?: string;
}

export interface IssueLinkType {
  id: string;
  name: string;
  inward: string;   // e.g., "is blocked by"
  outward: string;  // e.g., "blocks"
  self?: string;
}

export interface LinkedIssue {
  id: string;
  key: string;
  self?: string;
  fields?: {
    summary?: string;
    status?: { name: string };
    issuetype?: { name: string };
    priority?: { name: string };
  };
}

export interface IssueLinkCreate {
  type: string;           // Link type name (e.g., "Blocks", "Relates", "Duplicates")
  inwardIssue?: string;   // Issue key that is the inward side
  outwardIssue?: string;  // Issue key that is the outward side
  comment?: string;       // Optional comment on the link
}

// Common issue link types
export enum IssueLinkTypeName {
  BLOCKS = "Blocks",
  CLONERS = "Cloners",
  DUPLICATE = "Duplicate",
  RELATES = "Relates",
}

// Sprint Analytics models
export interface SprintReport {
  sprint: Sprint;
  completedIssues: Issue[];
  incompleteIssues: Issue[];
  puntedIssues: Issue[];  // Issues removed from sprint
  addedIssues: Issue[];   // Issues added mid-sprint
  completedPoints: number;
  totalPoints: number;
  completionRate: number; // Percentage of points completed
  issueCompletionRate: number; // Percentage of issues completed
}

export interface SprintVelocity {
  sprintId: number;
  sprintName: string;
  completedPoints: number;
  committedPoints: number;
  completedIssues: number;
  totalIssues: number;
}

export interface VelocityReport {
  boardId: number;
  sprints: SprintVelocity[];
  averageVelocity: number;
  velocityTrend: "increasing" | "decreasing" | "stable";
}

export interface BurndownPoint {
  date: string;
  remainingPoints: number;
  idealPoints: number;
  completedPoints: number;
}

export interface SprintBurndown {
  sprintId: number;
  sprintName: string;
  startDate: string;
  endDate: string;
  totalPoints: number;
  dataPoints: BurndownPoint[];
}

// JQL Filter models
export interface JqlFilter {
  id: string;
  name: string;
  description?: string;
  owner?: User;
  jql: string;
  viewUrl: string;
  searchUrl: string;
  favourite: boolean;
  favouritedCount: number;
  sharePermissions: FilterSharePermission[];
  editPermissions: FilterSharePermission[];
  self?: string;
}

export interface FilterSharePermission {
  id: number;
  type: "global" | "group" | "project" | "projectRole" | "user" | "loggedIn" | "authenticated";
  group?: { name: string; groupId?: string };
  project?: { id: string; key: string; name: string };
  role?: { id: number; name: string };
  user?: User;
}

export interface FilterCreate {
  name: string;
  description?: string;
  jql: string;
  favourite?: boolean;
  sharePermissions?: FilterSharePermission[];
  editPermissions?: FilterSharePermission[];
}

export interface FilterUpdate {
  name?: string;
  description?: string;
  jql?: string;
  favourite?: boolean;
  sharePermissions?: FilterSharePermission[];
  editPermissions?: FilterSharePermission[];
}

// Common webhook events
export enum WebhookEvent {
  // Issue events
  ISSUE_CREATED = "jira:issue_created",
  ISSUE_UPDATED = "jira:issue_updated",
  ISSUE_DELETED = "jira:issue_deleted",
  // Comment events
  COMMENT_CREATED = "comment_created",
  COMMENT_UPDATED = "comment_updated",
  COMMENT_DELETED = "comment_deleted",
  // Sprint events
  SPRINT_CREATED = "sprint_created",
  SPRINT_UPDATED = "sprint_updated",
  SPRINT_STARTED = "sprint_started",
  SPRINT_CLOSED = "sprint_closed",
  SPRINT_DELETED = "sprint_deleted",
  // Board events
  BOARD_CREATED = "board_created",
  BOARD_UPDATED = "board_updated",
  BOARD_DELETED = "board_deleted",
  // Worklog events
  WORKLOG_CREATED = "worklog_created",
  WORKLOG_UPDATED = "worklog_updated",
  WORKLOG_DELETED = "worklog_deleted",
}
