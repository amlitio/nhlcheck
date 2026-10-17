// Dependency-free JavaScript syntax validation for this unbundled application.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const excluded = new Set(['.git', 'node_modules', '.vercel']);
function check(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(item.name)) continue;
    const file = join(directory, item.name);
    if (item.isDirectory()) check(file);
    else if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exitCode = 1;
    }
  }
}
check(process.cwd());
