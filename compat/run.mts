// Verifies that the packed @k11i/bolt-s3 and @k11i/bolt-dynamodb work in a
// consumer project together with each given major version of @slack/bolt.
//
// Usage: node compat/run.mts <bolt-major>...  (LocalStack must be running)
//
// Set COMPAT_KEEP_WORK_DIR=1 to keep the consumer projects for debugging.

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const compatDir = import.meta.dirname;
const rootDir = path.dirname(compatDir);

const packages = ['@k11i/bolt-s3', '@k11i/bolt-dynamodb'];
const sharedDependencies = ['@slack/oauth', '@slack/logger'];

// Older majors of @slack/* bring in outdated transitive dependencies, so never
// run their install scripts.
const npmOptions = ['--ignore-scripts', '--no-audit', '--no-fund'];

function run(command: string, args: string[], cwd: string): void {
  childProcess.execFileSync(command, args, {cwd, stdio: 'inherit'});
}

function findPackageDir(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return fs.realpathSync(candidate);
    }
    if (dir === path.dirname(dir)) {
      return undefined;
    }
  }
}

function resolvePackageDir(name: string, fromDir: string): string {
  const packageDir = findPackageDir(name, fromDir);
  if (packageDir === undefined) {
    throw new Error(`Cannot resolve ${name} from ${fromDir}`);
  }
  return packageDir;
}

function versionOf(packageDir: string): string {
  const packageJson = path.join(packageDir, 'package.json');
  return JSON.parse(fs.readFileSync(packageJson, 'utf8')).version;
}

// Checks that @k11i/bolt-* share @slack/* packages with @slack/bolt, i.e. that
// their dependency ranges accept the versions @slack/bolt depends on.
function checkSharedDependencies(projectDir: string): void {
  const boltDir = resolvePackageDir('@slack/bolt', projectDir);
  console.log(`@slack/bolt ${versionOf(boltDir)}`);

  let succeeded = true;
  for (const dependency of sharedDependencies) {
    const expected = resolvePackageDir(dependency, boltDir);
    for (const pkg of packages) {
      const actual = findPackageDir(
        dependency,
        resolvePackageDir(pkg, projectDir),
      );
      const shared = actual === expected;
      succeeded &&= shared;
      console.log(
        `${shared ? 'OK' : 'NG'}  ${pkg} -> ${dependency}` +
          ` ${actual === undefined ? '(not found)' : versionOf(actual)}` +
          ` (@slack/bolt -> ${versionOf(expected)})`,
      );
    }
  }

  if (!succeeded) {
    throw new Error(
      'Some @slack/* packages are not shared with @slack/bolt.' +
        ' Check the dependency ranges of @k11i/bolt-*.',
    );
  }
}

function buildAndPack(workDir: string): string[] {
  console.log('==> Building and packing packages');
  run('npm', ['run', 'build'], rootDir);
  run(
    'npm',
    [
      'pack',
      ...packages.flatMap((pkg) => ['-w', pkg]),
      '--pack-destination',
      workDir,
    ],
    rootDir,
  );
  return fs
    .readdirSync(workDir)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => path.join(workDir, file));
}

function verify(boltMajor: string, workDir: string, tarballs: string[]): void {
  const label = `[@slack/bolt@${boltMajor}]`;

  // The template files are not named package.json / package-lock.json so that
  // the dependency graph of GitHub (and thus Dependabot) ignores them.
  const projectDir = path.join(workDir, `bolt-${boltMajor}`);
  fs.mkdirSync(projectDir);
  fs.cpSync(path.join(compatDir, 'src'), path.join(projectDir, 'src'), {
    recursive: true,
  });
  for (const [from, to] of [
    ['tsconfig.json', 'tsconfig.json'],
    ['package.template.json', 'package.json'],
    ['package-lock.template.json', 'package-lock.json'],
  ]) {
    fs.cpSync(path.join(compatDir, from), path.join(projectDir, to));
  }

  console.log(`==> ${label} Installing dependencies`);
  run('npm', ['ci', ...npmOptions], projectDir);
  run('npm', ['uninstall', ...npmOptions, '@slack/bolt'], projectDir);
  run(
    'npm',
    ['install', ...npmOptions, `@slack/bolt@^${boltMajor}`],
    projectDir,
  );
  // Install @k11i/bolt-* last, as if adding them to an existing Bolt app.
  run('npm', ['install', ...npmOptions, ...tarballs], projectDir);

  console.log(`==> ${label} Checking dependency resolution`);
  checkSharedDependencies(projectDir);

  console.log(`==> ${label} Type checking`);
  run('npx', ['tsc', '-p', 'tsconfig.json'], projectDir);

  console.log(`==> ${label} Running tests`);
  run('npx', ['vitest', 'run'], projectDir);
}

const boltMajors = process.argv.slice(2);
if (boltMajors.length === 0) {
  console.error('Usage: node compat/run.mts <bolt-major>...');
  process.exit(2);
}

// The consumer projects must live outside this repository so that module
// resolution never falls back to the repository's node_modules.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
const keepWorkDir = process.env.COMPAT_KEEP_WORK_DIR === '1';
if (keepWorkDir) {
  console.log(`Keeping work directory: ${workDir}`);
}

try {
  const tarballs = buildAndPack(workDir);
  for (const boltMajor of boltMajors) {
    verify(boltMajor, workDir, tarballs);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (!keepWorkDir) {
    fs.rmSync(workDir, {recursive: true, force: true});
  }
}
