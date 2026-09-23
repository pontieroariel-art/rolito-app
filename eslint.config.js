import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
  // Lint con tipos (2026-09-22, auditoría): promesas flotantes. En las pantallas
  // de calle y planta la escritura se dispara sin await A PROPÓSITO (modo sin
  // señal: `fireAndForget` / `esperarOEncolar` ya reportan el rechazo); en las
  // de oficina un `permission-denied` o un corte de red dejaba la pantalla
  // diciendo "hecho" y nadie se enteraba. Toda promesa que no se espera lleva
  // `.catch(reportError)` o un `void` que diga por qué. `src/sw.ts` queda
  // afuera porque no está en tsconfig.json (tiene su propio contexto de build).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/sw.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // `attributes: false`: un `onClick={async () => …}` es el patrón normal de
      // React; lo que importa es lo que hace adentro.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
  {
    files: ['functions/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      // Endurecido el 2026-09-22 (auditoría): functions ya estaba en 0 any y
      // tenía 3 símbolos sin uso. Lo que empieza con _ es deliberado.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
  // Al final: apaga las reglas de ESLint que compiten con Prettier (estilo,
  // no bugs) para que no haya conflictos entre `eslint --fix` y `format`.
  eslintConfigPrettier,
)
