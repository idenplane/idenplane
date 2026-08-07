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
  // jose: ships ESM only. sanitize-html's HTML parser (bumped as of its
  // 2.17.6 release) pulls in a whole nested ESM-only tree — htmlparser2,
  // domutils, domhandler, domelementtype, entities, all under
  // node_modules/sanitize-html/node_modules/* — that all need ts-jest to
  // actually transform them instead of Jest's default of treating everything
  // under node_modules as already-CommonJS.
  //
  // A simple `node_modules/(?!jose|htmlparser2)` doesn't work: Jest matches
  // this pattern against the whole path, and the first "node_modules/"
  // segment here is followed by "sanitize-html", not "htmlparser2", so the
  // negative lookahead succeeds and Jest ignores the file anyway. Instead,
  // exclude anything under sanitize-html's OWN node_modules wholesale, so
  // new transitive ESM deps added there later don't silently break tests
  // again the same way.
  transformIgnorePatterns: [
    '^(?!.*node_modules/(jose|sanitize-html/node_modules)/).*node_modules/.*$',
  ],
};
