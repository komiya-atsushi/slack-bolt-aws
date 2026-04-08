import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
    },
    maxWorkers: 1,
    fileParallelism: false,
  }
});
