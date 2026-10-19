// 배포 tarball 계약: npm pack이 담을 파일 목록이 실행에 필요한 것만이고, 담긴 코드의 상대 import가 모두 목록 안에 있는지 확인한다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
// 목록만 만든다. tarball은 만들지 않는다.
const listing = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }),
)[0];
const files = new Set(listing.files.map((file) => file.path));

test('pack_contains_only_what_the_engine_runs_on', () => {
  for (const required of [
    'index.js',
    'package.json',
    'theme/default-theme.js',
    'parser/parse-document.js',
    'renderer/render-document.js',
  ]) {
    assert.ok(files.has(required), `${required} must be packed`);
  }
  const allowed = /^(?:index\.js|package\.json|README\.md|LICENSE|parser\/|renderer\/|theme\/)/;
  const stray = [...files].filter((path) => !allowed.test(path));
  assert.deepEqual(stray, [], 'nothing outside the allowlist is packed');
  const forbidden = [...files].filter((path) =>
    /(?:^|\/)(?:test|scripts|node_modules|\.local)\/|\.tgz$|\/Users\//.test(path),
  );
  assert.deepEqual(forbidden, [], 'tests, dev scripts and tarballs are not packed');
});

test('every_relative_import_of_the_packed_code_is_in_the_pack', () => {
  const missing = [];
  for (const path of files) {
    if (!/\.m?js$/.test(path)) continue;
    const source = readFileSync(new URL(path, root), 'utf8');
    for (const match of source.matchAll(/(?:from|import\()\s*'(\.[^']+)'|new URL\('(\.[^']+)'/g)) {
      const target = posix
        .normalize(posix.join(posix.dirname(path), match[1] ?? match[2]))
        .replace(/\/$/, '');
      const present = files.has(target) || [...files].some((file) => file.startsWith(`${target}/`));
      if (!present) missing.push(`${path} -> ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('design_and_renderer_are_peer_dependencies_pinned_to_commits_for_the_tests', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  for (const [name, repository] of [
    ['@woonyong-choi/design-tokens', 'design-tokens'],
    ['diagramplay', 'diagramplay'],
  ]) {
    assert.equal(pkg.peerDependencies[name], '^0.2.0', name);
    assert.match(
      pkg.devDependencies[name],
      new RegExp(`^github:woonyong-choi/${repository}#[0-9a-f]{40}$`),
      name,
    );
    assert.equal(pkg.dependencies[name], undefined, name);
  }
  for (const dependencies of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
    assert.equal(dependencies.thinkflow, undefined);
    assert.equal(dependencies['torso-diagram'], undefined);
  }
  assert.equal(pkg.scripts.prepare, undefined);
  assert.equal(pkg.scripts.prepack, undefined);
});
