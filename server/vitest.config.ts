import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  test: {
    env: { DATA_DIR: path.join(os.tmpdir(), 'kb-bench-test-data') },
    testTimeout: 30_000,
  },
});
