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
  const allowed =
    /^(?:index\.js|package\.json|README\.md|LICENSE|parser\/|preview\/|renderer\/|theme\/)/;
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
  for (const [name, repository, range] of [
    ['@woonyong-choi/design-tokens', 'design-tokens', '^0.2.0'],
    ['diagramplay', 'diagramplay', '^0.3.0'],
  ]) {
    assert.equal(pkg.peerDependencies[name], range, name);
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

test('only_the_root_parser_and_preview_entry_points_are_importable_by_package_name', async () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.deepEqual(Object.keys(pkg.exports), ['.', './parser', './preview', './package.json']);
  const engine = await import('document-engine');
  assert.equal(typeof engine.parseDocument, 'function');
  assert.equal(typeof engine.renderDocument, 'function');
  assert.equal(engine.DirectiveError, undefined);
  const parser = await import('document-engine/parser');
  assert.deepEqual(Object.keys(parser), ['parseDocumentSync']);
  assert.equal(parser.parseDocumentSync('x', { id: 'a' }).version, 1);
  const preview = await import('document-engine/preview');
  assert.deepEqual(Object.keys(preview).sort(), ['parseDocumentSync', 'renderPreview']);
  for (const internal of [
    'document-engine/parser/parse-document.js',
    'document-engine/renderer/kit.js',
    'document-engine/theme/default-theme.js',
    'document-engine/index.js',
  ]) {
    await assert.rejects(import(internal), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, internal);
  }
});

test('dependencies_declare_only_what_the_engine_uses', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.deepEqual(pkg.peerDependenciesMeta, { diagramplay: { optional: true } });
  assert.equal(pkg.devDependencies['markdown-it-task-lists'], undefined);
  // @vscode/markdown-it-katex가 선언한 katex ^0.16.4 대신 엔진과 같은 katex를 쓰게 하는 강제 하나만 둔다.
  assert.deepEqual(pkg.overrides, { katex: pkg.dependencies.katex });
  const used = new Set();
  for (const path of files) {
    if (!/\.m?js$/.test(path)) continue;
    const source = readFileSync(new URL(path, root), 'utf8');
    for (const match of source.matchAll(/(?:from|import\()\s*'([^'.][^']*)'/g)) {
      used.add(
        match[1].startsWith('@')
          ? match[1].split('/').slice(0, 2).join('/')
          : match[1].split('/')[0],
      );
    }
  }
  for (const name of Object.keys(pkg.dependencies)) assert.ok(used.has(name), `${name} is unused`);
});

test('a_host_without_diagramplay_renders_documents_and_gets_a_clear_diagram_error', () => {
  const script = `
    import { register } from 'node:module';
    register(${JSON.stringify(new URL('test/support/without-diagramplay.mjs', root).href)});
    const { compileDiagram, documentEngine } = await import(${JSON.stringify(new URL('index.js', root).href)});
    const document = await documentEngine.parseDocument('# 제목\\n', { id: 'a' });
    const { html } = await documentEngine.renderDocument(document);
    let message = '';
    try { await compileDiagram('diagramplay\\nbox a "A"\\n'); } catch (error) { message = error.message; }
    process.stdout.write(JSON.stringify({ html, message }));
  `;
  const output = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }),
  );
  assert.match(output.html, /<h1 id="제목"/);
  assert.match(output.message, /diagramplay\(\^0\.2\.0\)를 설치해야 합니다/);
});
