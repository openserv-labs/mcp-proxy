module.exports = {
    env: {
      node: true
    },
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'prettier'],
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:prettier/recommended'
    ],
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
}