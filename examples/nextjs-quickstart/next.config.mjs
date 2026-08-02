import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this directory — otherwise Next.js walks up to
  // the monorepo root (it finds package-lock.json there too) and warns.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
