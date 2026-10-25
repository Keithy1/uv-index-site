import { defineConfig } from "vitest/config";

// Plain Node environment: everything under test is pure logic (parsing, bands,
// time zones, SQL string building). Worker-integration tests would need
// @cloudflare/vitest-pool-workers and workerd; added only when there is a
// behaviour that genuinely cannot be tested without the runtime.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
