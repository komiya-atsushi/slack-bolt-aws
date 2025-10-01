import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    poolOptions: {
      threads: {
        singleThread: true
      }
    },
    fileParallelism: false,
  }
});
