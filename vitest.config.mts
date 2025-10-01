import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
    },
    poolOptions: {
      threads: {
        singleThread: true
      }
    },
    fileParallelism: false,
  }
});
