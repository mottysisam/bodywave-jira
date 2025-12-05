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
