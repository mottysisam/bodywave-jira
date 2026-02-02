import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ConfluenceClient, ConfluenceClientError } from "../src/confluence-client.js";
import axios from "axios";

// Mock axios
vi.mock("axios", () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };

  return {
    default: {
      create: vi.fn(() => ({
        ...mockAxiosInstance,
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      })),
    },
    AxiosError: class AxiosError extends Error {
      response?: { status: number; data: unknown };
      constructor(message: string) {
        super(message);
        this.name = "AxiosError";
      }
    },
  };
});

describe("ConfluenceClient", () => {
  let client: ConfluenceClient;
  let v2Mock: ReturnType<typeof getV2Mock>;
  let v1Mock: ReturnType<typeof getV1Mock>;

  function getV2Mock() {
    return (axios.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
  }

  function getV1Mock() {
    return (axios.create as ReturnType<typeof vi.fn>).mock.results[1]?.value;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    client = new ConfluenceClient({
      baseUrl: "https://test.atlassian.net/wiki/api/v2",
      v1BaseUrl: "https://test.atlassian.net/wiki/rest/api",
      email: "test@example.com",
      apiKey: "test-api-key",
    });

    v2Mock = getV2Mock();
    v1Mock = getV1Mock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create two axios instances (v2 and v1)", () => {
      expect(axios.create).toHaveBeenCalledTimes(2);

      const calls = (axios.create as ReturnType<typeof vi.fn>).mock.calls;

      // v2 client
      expect(calls[0][0].baseURL).toBe("https://test.atlassian.net/wiki/api/v2");
      expect(calls[0][0].headers.Authorization).toContain("Basic ");

      // v1 client
      expect(calls[1][0].baseURL).toBe("https://test.atlassian.net/wiki/rest/api");
      expect(calls[1][0].headers.Authorization).toContain("Basic ");
    });

    it("should use correct base64 auth encoding", () => {
      const expectedAuth = Buffer.from("test@example.com:test-api-key").toString("base64");
      const calls = (axios.create as ReturnType<typeof vi.fn>).mock.calls;

      expect(calls[0][0].headers.Authorization).toBe(`Basic ${expectedAuth}`);
      expect(calls[1][0].headers.Authorization).toBe(`Basic ${expectedAuth}`);
    });
  });

  describe("ConfluenceClientError", () => {
    it("should create error with message", () => {
      const error = new ConfluenceClientError("test error");
      expect(error.message).toBe("test error");
      expect(error.name).toBe("ConfluenceClientError");
    });

    it("should create error with status code and details", () => {
      const error = new ConfluenceClientError("not found", 404, { key: "val" });
      expect(error.statusCode).toBe(404);
      expect(error.details).toEqual({ key: "val" });
    });
  });

  // ==================== Space Operations ====================

  describe("listSpaces", () => {
    it("should list spaces", async () => {
      v2Mock.get.mockResolvedValue({
        data: {
          results: [
            { id: "1", key: "ENG", name: "Engineering", type: "global" },
          ],
          _links: {},
        },
      });

      const result = await client.listSpaces();
      expect(v2Mock.get).toHaveBeenCalledWith("/spaces", { params: {} });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].key).toBe("ENG");
    });

    it("should pass filter params", async () => {
      v2Mock.get.mockResolvedValue({
        data: { results: [], _links: {} },
      });

      await client.listSpaces({ type: "global", limit: 10 });
      expect(v2Mock.get).toHaveBeenCalledWith("/spaces", {
        params: { type: "global", limit: 10 },
      });
    });
  });

  describe("getSpace", () => {
    it("should get a space by ID", async () => {
      v2Mock.get.mockResolvedValue({
        data: { id: "123", key: "ENG", name: "Engineering" },
      });

      const result = await client.getSpace("123");
      expect(v2Mock.get).toHaveBeenCalledWith("/spaces/123", {
        params: { "description-format": "plain" },
      });
      expect(result.key).toBe("ENG");
    });
  });

  describe("createSpace", () => {
    it("should create a space", async () => {
      v2Mock.post.mockResolvedValue({
        data: { id: "456", key: "DEV", name: "Development", type: "global" },
      });

      const result = await client.createSpace({ key: "DEV", name: "Development" });
      expect(v2Mock.post).toHaveBeenCalledWith("/spaces", {
        key: "DEV",
        name: "Development",
        type: "global",
      });
      expect(result.key).toBe("DEV");
    });

    it("should include description if provided", async () => {
      v2Mock.post.mockResolvedValue({
        data: { id: "456", key: "DEV", name: "Development" },
      });

      await client.createSpace({ key: "DEV", name: "Development", description: "A dev space" });
      expect(v2Mock.post).toHaveBeenCalledWith("/spaces", expect.objectContaining({
        description: { plain: { value: "A dev space", representation: "plain" } },
      }));
    });
  });

  describe("deleteSpace", () => {
    it("should delete a space", async () => {
      v2Mock.delete.mockResolvedValue({ data: {} });

      await client.deleteSpace("123");
      expect(v2Mock.delete).toHaveBeenCalledWith("/spaces/123");
    });
  });

  // ==================== Page Operations ====================

  describe("getPage", () => {
    it("should get a page by ID", async () => {
      v2Mock.get.mockResolvedValue({
        data: { id: "100", title: "Test Page", spaceId: "1", status: "current" },
      });

      const result = await client.getPage("100");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100", { params: {} });
      expect(result.title).toBe("Test Page");
    });

    it("should pass body format parameter", async () => {
      v2Mock.get.mockResolvedValue({
        data: { id: "100", title: "Test Page" },
      });

      await client.getPage("100", "storage" as any);
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100", {
        params: { "body-format": "storage" },
      });
    });
  });

  describe("createPage", () => {
    it("should create a page with body", async () => {
      v2Mock.post.mockResolvedValue({
        data: { id: "200", title: "New Page", spaceId: "1", status: "current" },
      });

      const result = await client.createPage({
        spaceId: "1",
        title: "New Page",
        body: "<p>Hello</p>",
      });

      expect(v2Mock.post).toHaveBeenCalledWith("/pages", {
        spaceId: "1",
        title: "New Page",
        status: "current",
        body: {
          representation: "storage",
          value: "<p>Hello</p>",
        },
      });
      expect(result.title).toBe("New Page");
    });

    it("should create a page without body", async () => {
      v2Mock.post.mockResolvedValue({
        data: { id: "200", title: "Empty Page", spaceId: "1" },
      });

      await client.createPage({ spaceId: "1", title: "Empty Page" });
      expect(v2Mock.post).toHaveBeenCalledWith("/pages", {
        spaceId: "1",
        title: "Empty Page",
        status: "current",
      });
    });
  });

  describe("updatePage", () => {
    it("should auto-increment version and update page", async () => {
      // First call: getPage to fetch current version
      v2Mock.get.mockResolvedValueOnce({
        data: { id: "100", title: "Old Title", status: "current", version: { number: 3 } },
      });
      // Second call: actual update response
      v2Mock.put.mockResolvedValue({
        data: { id: "100", title: "New Title", version: { number: 4 } },
      });

      const result = await client.updatePage("100", { title: "New Title", body: "<p>Updated</p>" });

      expect(v2Mock.put).toHaveBeenCalledWith("/pages/100", {
        id: "100",
        status: "current",
        title: "New Title",
        version: { number: 4, message: "" },
        body: { representation: "storage", value: "<p>Updated</p>" },
      });
      expect(result.title).toBe("New Title");
    });
  });

  describe("deletePage", () => {
    it("should delete a page", async () => {
      v2Mock.delete.mockResolvedValue({ data: {} });

      await client.deletePage("100");
      expect(v2Mock.delete).toHaveBeenCalledWith("/pages/100");
    });
  });

  describe("getChildPages", () => {
    it("should get child pages", async () => {
      v2Mock.get.mockResolvedValue({
        data: {
          results: [{ id: "101", title: "Child Page" }],
          _links: {},
        },
      });

      const result = await client.getChildPages("100");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100/children", { params: {} });
      expect(result.results).toHaveLength(1);
    });
  });

  describe("getPageAncestors", () => {
    it("should get page ancestors", async () => {
      v2Mock.get.mockResolvedValue({
        data: { results: [{ id: "1", title: "Root" }] },
      });

      const result = await client.getPageAncestors("100");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100/ancestors");
      expect(result).toHaveLength(1);
    });
  });

  // ==================== Search Operations ====================

  describe("search", () => {
    it("should search using CQL via v1 API", async () => {
      v1Mock.get.mockResolvedValue({
        data: {
          results: [{ title: "Found Page", excerpt: "..." }],
          start: 0,
          limit: 25,
          size: 1,
          totalSize: 1,
        },
      });

      const result = await client.search('type=page AND space=ENG');
      expect(v1Mock.get).toHaveBeenCalledWith("/search", {
        params: { cql: "type=page AND space=ENG" },
      });
      expect(result.results).toHaveLength(1);
    });

    it("should pass limit and start params", async () => {
      v1Mock.get.mockResolvedValue({
        data: { results: [], start: 10, limit: 5, size: 0, totalSize: 0 },
      });

      await client.search("text~test", { limit: 5, start: 10 });
      expect(v1Mock.get).toHaveBeenCalledWith("/search", {
        params: { cql: "text~test", limit: 5, start: 10 },
      });
    });
  });

  // ==================== Comment Operations ====================

  describe("getPageComments", () => {
    it("should get page footer comments", async () => {
      v2Mock.get.mockResolvedValue({
        data: {
          results: [{ id: "c1", status: "current" }],
          _links: {},
        },
      });

      const result = await client.getPageComments("100");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100/footer-comments", { params: {} });
      expect(result.results).toHaveLength(1);
    });
  });

  describe("getComment", () => {
    it("should get a comment by ID", async () => {
      v2Mock.get.mockResolvedValue({
        data: { id: "c1", status: "current" },
      });

      const result = await client.getComment("c1");
      expect(v2Mock.get).toHaveBeenCalledWith("/footer-comments/c1", { params: {} });
      expect(result.id).toBe("c1");
    });
  });

  describe("createComment", () => {
    it("should create a footer comment", async () => {
      v2Mock.post.mockResolvedValue({
        data: { id: "c2", status: "current" },
      });

      const result = await client.createComment("100", { body: "<p>Nice!</p>" });
      expect(v2Mock.post).toHaveBeenCalledWith("/footer-comments", {
        pageId: "100",
        body: { representation: "storage", value: "<p>Nice!</p>" },
      });
      expect(result.id).toBe("c2");
    });
  });

  describe("updateComment", () => {
    it("should auto-increment version and update comment", async () => {
      // getComment fetch
      v2Mock.get.mockResolvedValueOnce({
        data: { id: "c1", status: "current", version: { number: 2 } },
      });
      v2Mock.put.mockResolvedValue({
        data: { id: "c1", version: { number: 3 } },
      });

      await client.updateComment("c1", { body: "<p>Updated</p>" });
      expect(v2Mock.put).toHaveBeenCalledWith("/footer-comments/c1", {
        version: { number: 3 },
        body: { representation: "storage", value: "<p>Updated</p>" },
      });
    });
  });

  describe("deleteComment", () => {
    it("should delete a comment", async () => {
      v2Mock.delete.mockResolvedValue({ data: {} });

      await client.deleteComment("c1");
      expect(v2Mock.delete).toHaveBeenCalledWith("/footer-comments/c1");
    });
  });

  // ==================== Label Operations ====================

  describe("getPageLabels", () => {
    it("should get page labels via v2 API", async () => {
      v2Mock.get.mockResolvedValue({
        data: {
          results: [{ id: "l1", name: "important", prefix: "global" }],
          _links: {},
        },
      });

      const result = await client.getPageLabels("100");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100/labels", { params: {} });
      expect(result.results).toHaveLength(1);
    });
  });

  describe("addPageLabels", () => {
    it("should add labels via v1 API", async () => {
      v1Mock.post.mockResolvedValue({
        data: { results: [{ id: "l1", name: "test", prefix: "global" }] },
      });

      const result = await client.addPageLabels("100", ["test", "important"]);
      expect(v1Mock.post).toHaveBeenCalledWith("/content/100/label", [
        { prefix: "global", name: "test" },
        { prefix: "global", name: "important" },
      ]);
      expect(result).toHaveLength(1);
    });
  });

  describe("removePageLabel", () => {
    it("should remove a label via v1 API", async () => {
      v1Mock.delete.mockResolvedValue({ data: {} });

      await client.removePageLabel("100", "old-label");
      expect(v1Mock.delete).toHaveBeenCalledWith("/content/100/label/old-label");
    });
  });

  // ==================== Attachment Operations ====================

  describe("getPageAttachments", () => {
    it("should get page attachments via v2 API", async () => {
      v2Mock.get.mockResolvedValue({
        data: {
          results: [{ id: "a1", title: "file.pdf", status: "current" }],
          _links: {},
        },
      });

      const result = await client.getPageAttachments("100");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100/attachments", { params: {} });
      expect(result.results).toHaveLength(1);
    });
  });

  describe("getAttachment", () => {
    it("should get an attachment by ID", async () => {
      v2Mock.get.mockResolvedValue({
        data: { id: "a1", title: "file.pdf" },
      });

      const result = await client.getAttachment("a1");
      expect(v2Mock.get).toHaveBeenCalledWith("/attachments/a1");
      expect(result.title).toBe("file.pdf");
    });
  });

  describe("deleteAttachment", () => {
    it("should delete an attachment", async () => {
      v2Mock.delete.mockResolvedValue({ data: {} });

      await client.deleteAttachment("a1");
      expect(v2Mock.delete).toHaveBeenCalledWith("/attachments/a1");
    });
  });

  // ==================== Content Property Operations ====================

  describe("getPageProperties", () => {
    it("should get all page properties", async () => {
      v2Mock.get.mockResolvedValue({
        data: {
          results: [{ id: "p1", key: "myProp", value: { foo: "bar" } }],
        },
      });

      const result = await client.getPageProperties("100");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100/properties");
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("myProp");
    });
  });

  describe("getPageProperty", () => {
    it("should get a specific property by key", async () => {
      v2Mock.get.mockResolvedValue({
        data: { id: "p1", key: "myProp", value: 42 },
      });

      const result = await client.getPageProperty("100", "myProp");
      expect(v2Mock.get).toHaveBeenCalledWith("/pages/100/properties/myProp");
      expect(result.value).toBe(42);
    });
  });

  describe("setPageProperty", () => {
    it("should create a new property when it doesn't exist", async () => {
      // getPageProperty throws (not found)
      v2Mock.get.mockRejectedValueOnce(new Error("Not found"));
      v2Mock.post.mockResolvedValue({
        data: { id: "p1", key: "newProp", value: "hello" },
      });

      const result = await client.setPageProperty("100", "newProp", "hello");
      expect(v2Mock.post).toHaveBeenCalledWith("/pages/100/properties", {
        key: "newProp",
        value: "hello",
      });
      expect(result.key).toBe("newProp");
    });

    it("should update existing property with version increment", async () => {
      // getPageProperty succeeds
      v2Mock.get.mockResolvedValueOnce({
        data: { id: "p1", key: "existProp", value: "old", version: { number: 2 } },
      });
      v2Mock.put.mockResolvedValue({
        data: { id: "p1", key: "existProp", value: "new", version: { number: 3 } },
      });

      const result = await client.setPageProperty("100", "existProp", "new");
      expect(v2Mock.put).toHaveBeenCalledWith("/pages/100/properties/existProp", {
        key: "existProp",
        value: "new",
        version: { number: 3 },
      });
      expect(result.value).toBe("new");
    });
  });
});
