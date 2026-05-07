export default {
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.vitest.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/app/services/**/*.ts', 'src/app/pages/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      thresholds: {
        statements: 70,
        branches: 55,
        functions: 70,
        lines: 70,
      },
    },
  },
};
