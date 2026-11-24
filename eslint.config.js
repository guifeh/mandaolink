// ESLint com checagem de tipos para todo o monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/dev-dist/**', '**/coverage/**', '**/.samples/**', '**/.profile-*/**', '**/*.js', '**/*.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // Pacotes Node usam NodeNext; o PWA tem o próprio tsconfig (bundler + DOM).
        project: ['./tsconfig.eslint.json', './apps/pwa/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Backlog visível (avisos, não bloqueiam): vêm quase todos de linhas do `pg` sem tipo.
      // Tipar as linhas do banco é uma task própria; depois disso viram 'error'.
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      // Estilo: async sem await é comum em handlers do Fastify e em fakes de teste.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['apps/pwa/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Testes: asserts em mocks e promessas do node:test são legítimos.
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'describe'] }] }],
    },
  },
  prettier,
);
