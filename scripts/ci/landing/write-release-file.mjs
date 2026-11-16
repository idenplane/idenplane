// Writes the landing site's single version source, src/data/release.ts, for
// a release. Used by .github/workflows/landing-version.yml.
//
//   node write-release-file.mjs <landing checkout> <version> <YYYY-MM-DD>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, version, date] = process.argv.slice(2);
if (!dir || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
  console.error('usage: write-release-file.mjs <landing dir> <X.Y.Z> <YYYY-MM-DD>');
  process.exit(2);
}
const body = `// The one place the site's "current Idenplane version" comes from. Every
// page that shows the version or links the latest release imports it.
//
// Updated automatically: on every published release, the idenplane repo's
// .github/workflows/landing-version.yml opens a pull request here that
// rewrites this file. Merging it redeploys the site. Edit by hand only to
// correct it.
export const LATEST_RELEASE = {
  version: '${version}',
  date: '${date}',
  url: 'https://github.com/idenplane/idenplane/releases/tag/v${version}',
} as const;

/** "v0.9.1": how the version is written on the site. */
export const LATEST_VERSION_LABEL = \`v\${LATEST_RELEASE.version}\`;
`;
writeFileSync(join(dir, 'src/data/release.ts'), body);
console.log(`src/data/release.ts -> ${version} (${date})`);
