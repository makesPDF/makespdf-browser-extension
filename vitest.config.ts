import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The build-output test runs esbuild for both packages; give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
