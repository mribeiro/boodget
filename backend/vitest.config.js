const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    isolate: true,
    pool: 'forks',
    include: ['test/**/*.test.js'],
  },
});
