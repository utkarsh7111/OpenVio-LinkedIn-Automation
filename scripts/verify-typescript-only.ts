import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Allowed configuration & tooling exceptions
const ALLOWLIST = new Set([
  path.normalize('frontend/postcss.config.js'),
  path.normalize('frontend/next.config.mjs'),
]);

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEARCH_DIRS = ['backend', 'frontend', 'mock-linkedin'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.next', 'uploads', '.git']);

const violations: string[] = [];

function scanDirectory(dir: string, baseDir: string = dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relFromRoot = path.normalize(path.relative(REPOSITORY_ROOT, fullPath));

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      scanDirectory(fullPath, baseDir);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.js' || ext === '.jsx' || ext === '.cjs' || ext === '.mjs') {
        if (!ALLOWLIST.has(relFromRoot)) {
          violations.push(relFromRoot);
        }
      }
    }
  }
}

console.log('--- Verifying TypeScript-Only Application Code ---');
for (const dir of SEARCH_DIRS) {
  scanDirectory(path.resolve(REPOSITORY_ROOT, dir));
}

if (violations.length > 0) {
  console.error('\n❌ VIOLATIONS FOUND: The following JavaScript/JSX files were found in application source directories:');
  for (const file of violations) {
    console.error(`  - ${file}`);
  }
  console.error('\nFuture application code must be written in TypeScript (.ts or .tsx) only.');
  process.exit(1);
} else {
  console.log('✅ PASS: Backend, frontend, and mock LinkedIn application source files are TypeScript (.ts / .tsx).');
  console.log('Allowed configuration/tooling exceptions (kept in JavaScript for framework compatibility):');
  for (const item of ALLOWLIST) {
    console.log(`  - ${item}`);
  }
  process.exit(0);
}
