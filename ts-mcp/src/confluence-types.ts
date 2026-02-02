/**
 * TypeScript types for Confluence integration in Bodywave Jira MCP Server
 *
 * Confluence uses two API versions:
 * - v2 (/wiki/api/v2): Pages, spaces, comments, attachments (read), properties
 * - v1 (/wiki/rest/api): Search (CQL), label writes, attachment uploads
 */

// Configuration for Confluence client
export interface ConfluenceConfig {
  baseUrl: string;      // e.g., https://your-domain.atlassian.net/wiki/api/v2
  v1BaseUrl: string;    // e.g., https://your-domain.atlassian.net/wiki/rest/api
  email: string;
  apiKey: string;
}

// Enums

export enum ConfluenceSpaceType {
  GLOBAL = "global",
  PERSONAL = "personal",
}

export enum ConfluencePageStatus {
  CURRENT = "current",
  DRAFT = "draft",
  TRASHED = "trashed",
}

export enum ConfluenceBodyFormat {
  STORAGE = "storage",       // XHTML-like: <p>Hello</p>
  ATLAS_DOC_FORMAT = "atlas_doc_format",
  VIEW = "view",
  EXPORT_VIEW = "export_view",
  ANONYMOUS_EXPORT_VIEW = "anonymous_export_view",
}

export enum ConfluenceCommentLocation {
  INLINE = "inline",
  FOOTER = "footer",
}

// Models

export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  type: ConfluenceSpaceType;
  status: string;
  description?: string;
  homepageId?: string;
  createdAt?: string;
  _links?: Record<string, string>;
}

export interface ConfluencePage {
  id: string;
  status: ConfluencePageStatus;
  title: string;
  spaceId: string;
  parentId?: string;
  parentType?: string;
  position?: number;
  authorId?: string;
  ownerId?: string;
  createdAt?: string;
  version?: ConfluenceVersion;
  body?: ConfluenceBody;
  _links?: Record<string, string>;
}

export interface ConfluenceVersion {
  number: number;
  message?: string;
  createdAt?: string;
  authorId?: string;
  minorEdit?: boolean;
}

export interface ConfluenceBody {
  storage?: { value: string; representation: string };
  atlas_doc_format?: { value: string; representation: string };
  view?: { value: string; representation: string };
}

export interface ConfluenceComment {
  id: string;
  status: string;
  title?: string;
  parentCommentId?: string;
  version?: ConfluenceVersion;
  body?: ConfluenceBody;
  pageId?: string;
  createdAt?: string;
  _links?: Record<string, string>;
}

export interface ConfluenceLabel {
  id: string;
  name: string;
  prefix: string;
}

export interface ConfluenceAttachment {
  id: string;
  status: string;
  title: string;
  mediaType?: string;
  mediaTypeDescription?: string;
  comment?: string;
  fileSize?: number;
  fileId?: string;
  version?: ConfluenceVersion;
  pageId?: string;
  createdAt?: string;
  _links?: Record<string, string>;
}

export interface ConfluenceContentProperty {
  id: string;
  key: string;
  value: unknown;
  version?: ConfluenceVersion;
}

// CRUD types

export interface ConfluenceSpaceCreate {
  key: string;
  name: string;
  description?: string;
  type?: ConfluenceSpaceType | string;
}

export interface ConfluencePageCreate {
  spaceId: string;
  title: string;
  parentId?: string;
  status?: ConfluencePageStatus;
  body?: string;             // Storage format HTML string
  bodyFormat?: ConfluenceBodyFormat;
}

export interface ConfluencePageUpdate {
  title?: string;
  body?: string;             // Storage format HTML string
  bodyFormat?: ConfluenceBodyFormat;
  status?: ConfluencePageStatus;
  versionMessage?: string;
}

export interface ConfluenceCommentCreate {
  body: string;              // Storage format HTML string
  bodyFormat?: ConfluenceBodyFormat;
}

// Pagination (cursor-based)

export interface ConfluencePaginatedResult<T> {
  results: T[];
  _links?: {
    next?: string;
    base?: string;
  };
  cursor?: string;
}

// Search (CQL via v1 API)

export interface ConfluenceSearchResult {
  results: ConfluenceSearchResultItem[];
  start: number;
  limit: number;
  size: number;
  totalSize: number;
  _links?: Record<string, string>;
}

export interface ConfluenceSearchResultItem {
  content?: {
    id: string;
    type: string;
    status: string;
    title: string;
    space?: {
      key: string;
      name: string;
      type: string;
    };
    _links?: Record<string, string>;
  };
  title: string;
  excerpt: string;
  url: string;
  resultGlobalContainer?: {
    title: string;
    displayUrl: string;
  };
  lastModified: string;
  friendlyLastModified: string;
}
