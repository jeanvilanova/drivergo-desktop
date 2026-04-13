import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    alias: {
      electron: path.resolve('./src/__mocks__/electron.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.test.ts',
        // External-process / OS-native integrations — not unit-testable without
        // a real Electron runtime, Windows SUBST commands, or 7-Zip binary:
        'src/lib/backup-runner.ts',
        'src/lib/drive-mapper.ts',
        // Pure streaming I/O transport layer — no business logic to unit-test:
        // putDirectToS3, downloadFileToLocal, downloadSharedFileToLocal are
        // all Node.js https/stream pipelines with no branching logic.
        'src/lib/uploader-main.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
