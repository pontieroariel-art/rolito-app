import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// Config lean, enfocada en bugs reales (no estilo). Arranca permisiva sobre el
// código existente: apagamos las reglas ruidosas que marcarían patrones ya
// usados deliberadamente, y dejamos como ERROR solo lo que atrapa bugs de verdad.
export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'functions/lib', 'node_modules', 'functions/node_modules'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Bugs reales de React hooks → error.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Ruido sobre código existente → off (se pueden endurecer más adelante).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
)
