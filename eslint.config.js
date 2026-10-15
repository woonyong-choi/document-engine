import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  { ignores: ['node_modules/', '.local/'] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    plugins: { sonarjs },
    rules: {
      'max-lines': ['warn', { max: 750, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', 7],
      'max-depth': ['warn', 3],
      'sonarjs/cognitive-complexity': ['warn', 15],
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-console': 'error',
      yoda: 'error',
      eqeqeq: 'error',
      'no-negated-condition': 'warn',
      'no-nested-ternary': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-restricted-syntax': ['error', 'ExportDefaultDeclaration'],
    },
  },
  { files: ['test/**'], rules: { 'max-lines-per-function': 'off' } },
  { files: ['eslint.config.js'], rules: { 'no-restricted-syntax': 'off' } },
];
