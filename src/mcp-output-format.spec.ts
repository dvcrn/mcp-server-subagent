// mcp-output-format.spec.ts - Tests for MCP tool output format validation

import { describe, it, expect } from "vitest";
import { z } from "zod";

// MCP content type schemas based on the protocol
const TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ImageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});

const ResourceContentSchema = z.object({
  type: z.literal("resource"),
  resource: z.object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
  }),
});

const MCPToolResponseSchema = z.object({
  content: z.array(
    z.union([TextContentSchema, ImageContentSchema, ResourceContentSchema])
  ),
});

describe("MCP Tool Output Format", () => {
  it("should validate text content responses", () => {
    const validTextResponse = {
      content: [
        {
          type: "text",
          text: "Message ID: abc-123\n\nInstructions here",
        },
      ],
    };

    const result = MCPToolResponseSchema.safeParse(validTextResponse);
    expect(result.success).toBe(true);
  });

  it("should reject responses with invalid content type", () => {
    const invalidResponse = {
      content: [
        {
          type: "json", // This is not a valid MCP content type
          json: { messageId: "abc-123" },
        },
      ],
    };

    const result = MCPToolResponseSchema.safeParse(invalidResponse);
    expect(result.success).toBe(false);
  });

  it("should reject responses missing required fields", () => {
    const missingTextField = {
      content: [
        {
          type: "text",
          // Missing 'text' field
        },
      ],
    };

    const result = MCPToolResponseSchema.safeParse(missingTextField);
    expect(result.success).toBe(false);
  });

  it("should validate the ask_parent response format", () => {
    // Simulate what index.ts returns for ask_parent
    const askParentResponse = {
      content: [
        {
          type: "text",
          text: `Message ID: ${crypto.randomUUID()}\n\nPoll for the answer using the 'check_message_status' tool with your runId and messageId. Since this could take a while for the parent to respond, use 'sleep 30' between calls to avoid spamming.`,
        },
      ],
    };

    const result = MCPToolResponseSchema.safeParse(askParentResponse);
    expect(result.success).toBe(true);
  });

  it("should validate multiple content items", () => {
    const multiContentResponse = {
      content: [
        {
          type: "text",
          text: "First message",
        },
        {
          type: "text",
          text: "Second message",
        },
      ],
    };

    const result = MCPToolResponseSchema.safeParse(multiContentResponse);
    expect(result.success).toBe(true);
    expect(result.data?.content).toHaveLength(2);
  });

  it("should show why JSON content type fails", () => {
    const jsonResponse = {
      content: [
        {
          type: "json",
          json: { messageId: "123", instructions: "test" },
        },
      ],
    };

    const result = MCPToolResponseSchema.safeParse(jsonResponse);
    expect(result.success).toBe(false);
    
    if (!result.success) {
      console.log("Validation errors:", JSON.stringify(result.error.errors, null, 2));
      // This will show that 'json' is not one of the valid literal values: 'text', 'image', 'resource'
    }
  });
});