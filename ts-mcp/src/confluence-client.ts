/**
 * Confluence REST API Client
 *
 * Uses the same credentials as Jira (email + API token on the same Atlassian domain).
 * Two internal API versions:
 * - v2 (/wiki/api/v2): Pages, spaces, comments, attachments (read), properties
 * - v1 (/wiki/rest/api): Search (CQL), label writes, attachment uploads
 *
 * Both share the same RateLimiter instance.
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import FormData from "form-data";
import {
  ConfluenceConfig,
  ConfluenceSpace,
  ConfluenceSpaceCreate,
  ConfluencePage,
  ConfluencePageCreate,
  ConfluencePageUpdate,
  ConfluencePageStatus,
  ConfluenceBodyFormat,
  ConfluenceComment,
  ConfluenceCommentCreate,
  ConfluenceLabel,
  ConfluenceAttachment,
  ConfluenceContentProperty,
  ConfluencePaginatedResult,
  ConfluenceSearchResult,
} from "./confluence-types.js";
import { RateLimiter } from "./rate-limiter.js";

export class ConfluenceClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "ConfluenceClientError";
  }
}

export class ConfluenceClient {
  private v2Client: AxiosInstance;
  private v1Client: AxiosInstance;
  private rateLimiter: RateLimiter;

  constructor(config: ConfluenceConfig) {
    this.rateLimiter = new RateLimiter();

    const auth = Buffer.from(`${config.email}:${config.apiKey}`).toString("base64");

    // Confluence v2 API client
    this.v2Client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Confluence v1 API client (for search/CQL, label writes, attachment uploads)
    this.v1Client = axios.create({
      baseURL: config.v1BaseUrl,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Apply rate limiting to both clients
    this.rateLimiter.applyTo(this.v2Client);
    this.rateLimiter.applyTo(this.v1Client);
  }

  private handleError(error: unknown): never {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const data = error.response?.data;
      const message =
        data?.message ||
        data?.errorMessage ||
        (Array.isArray(data?.errorMessages) ? data.errorMessages.join(", ") : null) ||
        error.message;
      throw new ConfluenceClientError(message, status, data);
    }
    throw error;
  }

  // ==================== Space Operations ====================

  /**
   * List all Confluence spaces
   */
  async listSpaces(options?: {
    type?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ConfluencePaginatedResult<ConfluenceSpace>> {
    try {
      const params: Record<string, unknown> = {};
      if (options?.type) params.type = options.type;
      if (options?.status) params.status = options.status;
      if (options?.limit) params.limit = options.limit;
      if (options?.cursor) params.cursor = options.cursor;

      const response = await this.v2Client.get("/spaces", { params });
      return {
        results: response.data.results || [],
        _links: response.data._links,
        cursor: this.extractCursor(response.data._links?.next),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific space by ID
   */
  async getSpace(spaceId: string): Promise<ConfluenceSpace> {
    try {
      const response = await this.v2Client.get(`/spaces/${spaceId}`, {
        params: { "description-format": "plain" },
      });
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create a new space
   */
  async createSpace(data: ConfluenceSpaceCreate): Promise<ConfluenceSpace> {
    try {
      const payload: Record<string, unknown> = {
        key: data.key,
        name: data.name,
        type: data.type || "global",
      };
      if (data.description) {
        payload.description = {
          plain: { value: data.description, representation: "plain" },
        };
      }

      const response = await this.v2Client.post("/spaces", payload);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete a space
   */
  async deleteSpace(spaceId: string): Promise<void> {
    try {
      await this.v2Client.delete(`/spaces/${spaceId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Page Operations ====================

  /**
   * List pages in a space
   */
  async listPages(options?: {
    spaceId?: string;
    status?: ConfluencePageStatus;
    title?: string;
    limit?: number;
    cursor?: string;
    bodyFormat?: ConfluenceBodyFormat;
  }): Promise<ConfluencePaginatedResult<ConfluencePage>> {
    try {
      const params: Record<string, unknown> = {};
      if (options?.spaceId) params["space-id"] = options.spaceId;
      if (options?.status) params.status = options.status;
      if (options?.title) params.title = options.title;
      if (options?.limit) params.limit = options.limit;
      if (options?.cursor) params.cursor = options.cursor;
      if (options?.bodyFormat) params["body-format"] = options.bodyFormat;

      const response = await this.v2Client.get("/pages", { params });
      return {
        results: response.data.results || [],
        _links: response.data._links,
        cursor: this.extractCursor(response.data._links?.next),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific page by ID
   */
  async getPage(pageId: string, bodyFormat?: ConfluenceBodyFormat): Promise<ConfluencePage> {
    try {
      const params: Record<string, unknown> = {};
      if (bodyFormat) params["body-format"] = bodyFormat;

      const response = await this.v2Client.get(`/pages/${pageId}`, { params });
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create a new page
   */
  async createPage(data: ConfluencePageCreate): Promise<ConfluencePage> {
    try {
      const payload: Record<string, unknown> = {
        spaceId: data.spaceId,
        title: data.title,
        status: data.status || "current",
      };
      if (data.parentId) {
        payload.parentId = data.parentId;
      }
      if (data.body) {
        const format = data.bodyFormat || ConfluenceBodyFormat.STORAGE;
        payload.body = {
          representation: format,
          value: data.body,
        };
      }

      const response = await this.v2Client.post("/pages", payload);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update an existing page (auto-increments version number)
   */
  async updatePage(pageId: string, data: ConfluencePageUpdate): Promise<ConfluencePage> {
    try {
      // Fetch current page to get version number
      const current = await this.getPage(pageId);
      const currentVersion = current.version?.number || 1;

      const payload: Record<string, unknown> = {
        id: pageId,
        status: data.status || current.status || "current",
        title: data.title || current.title,
        version: {
          number: currentVersion + 1,
          message: data.versionMessage || "",
        },
      };

      if (data.body) {
        const format = data.bodyFormat || ConfluenceBodyFormat.STORAGE;
        payload.body = {
          representation: format,
          value: data.body,
        };
      }

      const response = await this.v2Client.put(`/pages/${pageId}`, payload);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete a page
   */
  async deletePage(pageId: string): Promise<void> {
    try {
      await this.v2Client.delete(`/pages/${pageId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get child pages of a given page
   */
  async getChildPages(parentId: string, options?: {
    limit?: number;
    cursor?: string;
  }): Promise<ConfluencePaginatedResult<ConfluencePage>> {
    try {
      const params: Record<string, unknown> = {};
      if (options?.limit) params.limit = options.limit;
      if (options?.cursor) params.cursor = options.cursor;

      const response = await this.v2Client.get(`/pages/${parentId}/children`, { params });
      return {
        results: response.data.results || [],
        _links: response.data._links,
        cursor: this.extractCursor(response.data._links?.next),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get ancestor pages (parent chain)
   */
  async getPageAncestors(pageId: string): Promise<ConfluencePage[]> {
    try {
      const response = await this.v2Client.get(`/pages/${pageId}/ancestors`);
      return response.data.results || response.data || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Search Operations ====================

  /**
   * Search Confluence using CQL (Confluence Query Language) via v1 API
   */
  async search(cql: string, options?: {
    cqlcontext?: string;
    limit?: number;
    start?: number;
    excerpt?: string;
  }): Promise<ConfluenceSearchResult> {
    try {
      const params: Record<string, unknown> = { cql };
      if (options?.cqlcontext) params.cqlcontext = options.cqlcontext;
      if (options?.limit) params.limit = options.limit;
      if (options?.start) params.start = options.start;
      if (options?.excerpt) params.excerpt = options.excerpt;

      const response = await this.v1Client.get("/search", { params });
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Comment Operations ====================

  /**
   * Get comments on a page
   */
  async getPageComments(pageId: string, options?: {
    bodyFormat?: ConfluenceBodyFormat;
    limit?: number;
    cursor?: string;
  }): Promise<ConfluencePaginatedResult<ConfluenceComment>> {
    try {
      const params: Record<string, unknown> = {};
      if (options?.bodyFormat) params["body-format"] = options.bodyFormat;
      if (options?.limit) params.limit = options.limit;
      if (options?.cursor) params.cursor = options.cursor;

      const response = await this.v2Client.get(`/pages/${pageId}/footer-comments`, { params });
      return {
        results: response.data.results || [],
        _links: response.data._links,
        cursor: this.extractCursor(response.data._links?.next),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific comment by ID
   */
  async getComment(commentId: string, bodyFormat?: ConfluenceBodyFormat): Promise<ConfluenceComment> {
    try {
      const params: Record<string, unknown> = {};
      if (bodyFormat) params["body-format"] = bodyFormat;

      const response = await this.v2Client.get(`/footer-comments/${commentId}`, { params });
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create a footer comment on a page
   */
  async createComment(pageId: string, data: ConfluenceCommentCreate): Promise<ConfluenceComment> {
    try {
      const format = data.bodyFormat || ConfluenceBodyFormat.STORAGE;
      const payload = {
        pageId,
        body: {
          representation: format,
          value: data.body,
        },
      };

      const response = await this.v2Client.post("/footer-comments", payload);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update a comment
   */
  async updateComment(commentId: string, data: ConfluenceCommentCreate): Promise<ConfluenceComment> {
    try {
      // Fetch current comment to get version number
      const current = await this.getComment(commentId);
      const currentVersion = current.version?.number || 1;

      const format = data.bodyFormat || ConfluenceBodyFormat.STORAGE;
      const payload = {
        version: {
          number: currentVersion + 1,
        },
        body: {
          representation: format,
          value: data.body,
        },
      };

      const response = await this.v2Client.put(`/footer-comments/${commentId}`, payload);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string): Promise<void> {
    try {
      await this.v2Client.delete(`/footer-comments/${commentId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Label Operations ====================

  /**
   * Get labels on a page (v2 API)
   */
  async getPageLabels(pageId: string, options?: {
    limit?: number;
    cursor?: string;
  }): Promise<ConfluencePaginatedResult<ConfluenceLabel>> {
    try {
      const params: Record<string, unknown> = {};
      if (options?.limit) params.limit = options.limit;
      if (options?.cursor) params.cursor = options.cursor;

      const response = await this.v2Client.get(`/pages/${pageId}/labels`, { params });
      return {
        results: response.data.results || [],
        _links: response.data._links,
        cursor: this.extractCursor(response.data._links?.next),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Add labels to a page (v1 API - v2 doesn't support label writes)
   */
  async addPageLabels(pageId: string, labels: string[]): Promise<ConfluenceLabel[]> {
    try {
      const payload = labels.map(label => ({
        prefix: "global",
        name: label,
      }));

      // v1 uses content ID path
      const response = await this.v1Client.post(`/content/${pageId}/label`, payload);
      return response.data.results || response.data || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Remove a label from a page (v1 API)
   */
  async removePageLabel(pageId: string, label: string): Promise<void> {
    try {
      await this.v1Client.delete(`/content/${pageId}/label/${encodeURIComponent(label)}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Attachment Operations ====================

  /**
   * Get attachments on a page (v2 API)
   */
  async getPageAttachments(pageId: string, options?: {
    limit?: number;
    cursor?: string;
  }): Promise<ConfluencePaginatedResult<ConfluenceAttachment>> {
    try {
      const params: Record<string, unknown> = {};
      if (options?.limit) params.limit = options.limit;
      if (options?.cursor) params.cursor = options.cursor;

      const response = await this.v2Client.get(`/pages/${pageId}/attachments`, { params });
      return {
        results: response.data.results || [],
        _links: response.data._links,
        cursor: this.extractCursor(response.data._links?.next),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific attachment by ID
   */
  async getAttachment(attachmentId: string): Promise<ConfluenceAttachment> {
    try {
      const response = await this.v2Client.get(`/attachments/${attachmentId}`);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Upload an attachment to a page (v1 API - v2 doesn't support uploads)
   */
  async uploadAttachment(
    pageId: string,
    filename: string,
    content: string, // base64-encoded content
    comment?: string,
  ): Promise<ConfluenceAttachment> {
    try {
      const buffer = Buffer.from(content, "base64");
      const form = new FormData();
      form.append("file", buffer, { filename });
      if (comment) {
        form.append("comment", comment);
      }

      const response = await this.v1Client.post(
        `/content/${pageId}/child/attachment`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            "X-Atlassian-Token": "nocheck",
          },
        }
      );

      const results = response.data.results || [response.data];
      return results[0];
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Delete an attachment
   */
  async deleteAttachment(attachmentId: string): Promise<void> {
    try {
      await this.v2Client.delete(`/attachments/${attachmentId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Content Property Operations ====================

  /**
   * Get all properties on a page
   */
  async getPageProperties(pageId: string): Promise<ConfluenceContentProperty[]> {
    try {
      const response = await this.v2Client.get(`/pages/${pageId}/properties`);
      return response.data.results || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get a specific property by key
   */
  async getPageProperty(pageId: string, propertyKey: string): Promise<ConfluenceContentProperty> {
    try {
      const response = await this.v2Client.get(`/pages/${pageId}/properties/${propertyKey}`);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Set (create or update) a property on a page
   */
  async setPageProperty(pageId: string, key: string, value: unknown): Promise<ConfluenceContentProperty> {
    try {
      // Try to get existing property to determine create vs update
      let existingVersion: number | undefined;
      try {
        const existing = await this.getPageProperty(pageId, key);
        existingVersion = existing.version?.number;
      } catch {
        // Property doesn't exist yet - will create
      }

      if (existingVersion !== undefined) {
        // Update existing property
        const payload = {
          key,
          value,
          version: { number: existingVersion + 1 },
        };
        const response = await this.v2Client.put(`/pages/${pageId}/properties/${key}`, payload);
        return response.data;
      } else {
        // Create new property
        const payload = { key, value };
        const response = await this.v2Client.post(`/pages/${pageId}/properties`, payload);
        return response.data;
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  // ==================== Helpers ====================

  /**
   * Extract cursor token from a next link URL
   */
  private extractCursor(nextLink?: string): string | undefined {
    if (!nextLink) return undefined;
    try {
      const url = new URL(nextLink, "https://placeholder.com");
      return url.searchParams.get("cursor") || undefined;
    } catch {
      return undefined;
    }
  }
}
