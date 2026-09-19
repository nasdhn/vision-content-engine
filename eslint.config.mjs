import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['docs/**', '**/dist/**', '**/generated/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        structuredClone: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
);
