// LLMcordTS/vitest.config.ts
import { defineConfig, UserConfig } from 'vitest/config'; // Import UserConfig type

// Use async function to allow dynamic import, add return type
export default defineConfig(async (): Promise<UserConfig> => {
  // Dynamically import the ESM plugin
  const tsconfigPaths = (await import('vite-tsconfig-paths')).default;

  return {
    plugins: [tsconfigPaths()], // Add the plugin instance
    test: {
      globals: true, // Use Vitest globals (describe, it, expect, etc.)
      environment: 'node', // Specify the test environment
      // Add setup files if needed later (e.g., for mocking)
      // setupFiles: ['./tests/setup.ts'],
      coverage: {
        provider: 'v8', // or 'istanbul'
        reporter: ['text', 'json', 'html'], // Coverage reporters
        reportsDirectory: './coverage', // Output directory for coverage reports
        include: ['src/**'], // Explicitly include files in the src directory
        exclude: [ // Exclude common non-source files
            '**/node_modules/**',
            '**/dist/**',
            '**/tests/**',
            '**/*.test.ts',
            '**/*.config.ts',
            '**/*.d.ts',
            'src/types/**', // Exclude type definitions
            'src/main.ts', // Exclude main entry point if not testable directly
        ],
      },
      // alias configuration is handled by the plugin
    },
  };
});