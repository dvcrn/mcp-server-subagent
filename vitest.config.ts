import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true, // Allow using describe, it, expect, etc. without importing them
    environment: "node", // Specify that tests will run in a Node.js environment
    // You can add more configuration options here as needed
  },
});
