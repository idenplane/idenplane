/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // Override the project tsconfig's "module": "nodenext" to plain
    // "commonjs" for this transform only. Under nodenext, TypeScript
    // preserves a literal `await import(...)` expression verbatim (correct
    // for real Node, which supports dynamic import from CJS natively) — but
    // Jest's default CJS test environment can't execute that syntax without
    // --experimental-vm-modules. Plain "commonjs" makes TypeScript downlevel
    // it to a require()-based Promise instead, which Jest runs fine. This
    // only affects how ts-jest compiles for tests; the real build
    // (nest build / tsconfig.build.json) is untouched.
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // jose: ships ESM only. htmlparser2 (sanitize-html's parser, bumped in its
  // 2.17.6 release): also ESM-only as of its own recent bump. Both need
  // ts-jest to actually transform them instead of Jest's default of treating
  // everything under node_modules as already-CommonJS.
  transformIgnorePatterns: ['node_modules/(?!jose|htmlparser2)'],
};
