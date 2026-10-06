// Regenerates compat/package-lock.template.json from
// compat/package.template.json, resolving the latest versions in the ranges.
//
// Usage: node compat/update-lock.mts
//
// The files are not named package.json / package-lock.json so that the
// dependency graph of GitHub (and thus Dependabot) ignores them.

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const compatDir = import.meta.dirname;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-lock-'));
try {
  fs.cpSync(
    path.join(compatDir, 'package.template.json'),
    path.join(workDir, 'package.json'),
  );
  childProcess.execFileSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    {cwd: workDir, stdio: 'inherit'},
  );
  fs.cpSync(
    path.join(workDir, 'package-lock.json'),
    path.join(compatDir, 'package-lock.template.json'),
  );
} finally {
  fs.rmSync(workDir, {recursive: true, force: true});
}
