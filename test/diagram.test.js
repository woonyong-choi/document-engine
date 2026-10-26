import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getIconCatalog, readIcon } from '@woonyong-choi/design-tokens/icons';
import { buildFigure, toHtml } from 'diagramplay';

import { compileDiagram, compileDiagrams, documentEngine } from '../index.js';

import { snapshotTokens } from './support/snapshot.js';

const FENCES = ['diagramplay', 'thinkflow', 'torso'];
const BODY =
  'title "Mini"\nbox a "thinkflow torso diagramplay"\nbox b "B"\na -> b "go"\n\nscene "S"\n  a -> b "x"\n';

function copiedSource(html) {
  const script = /<script type="application\/json" class="fl-source">([\s\S]*?)<\/script>/.exec(
    html,
  );
  assert.ok(script, 'the player exposes copy source');
  return JSON.parse(script[1]);
}

function assertPlayerSource(html, source) {
  assert.equal(copiedSource(html), source);
  const meta = /<meta name="diagramplay-canonical" content="([^"]+)">/.exec(html);
  assert.ok(meta, 'the player exposes its canonical download');
  const template = Buffer.from(meta[1], 'base64').toString('utf8');
  assert.equal(copiedSource(template), source);
  assert.equal(
    template.replace(
      '<meta name="diagramplay-canonical" content="">',
      `<meta name="diagramplay-canonical" content="${meta[1]}">`,
    ),
    html,
    'canonical download reconstructs the same HTML bytes',
  );
}

test('compileDiagram_new_and_legacy_headers_preserve_copy_and_download_source', async () => {
  let dimensions;
  for (const header of FENCES) {
    for (const prefix of ['', '\uFEFF# comment\r\n\r\n  ']) {
      const ending = prefix ? '\r\n' : '\n';
      const source = `${prefix}${header} # declaration${ending}${BODY.replaceAll('\n', ending)}`;
      const result = await compileDiagram(source);

      assert.equal(result.title, 'Mini');
      assert.match(result.html.toString(), /aria-label="thinkflow torso diagramplay"/);
      assert.equal(result.scenes, 1);
      assert.match(result.src, /^\/diagrams\/[0-9a-f]{64}\.html$/);
      assertPlayerSource(result.html.toString(), source);
      assert.equal((await compileDiagram(source)).src, result.src);
      dimensions ??= result.dimensions;
      assert.deepEqual(result.dimensions, dimensions);
    }
  }
});

test('compileDiagram_only_valid_standalone_first_declarations_are_compatible', async () => {
  for (const header of ['thinkflow', 'torso']) {
    const accepted = `${header}# comment\n${BODY}`;
    assertPlayerSource((await compileDiagram(accepted)).html.toString(), accepted);
    for (const first of [`${header} 1`, `${header}x`, `${header} title=x`, `"${header}"`]) {
      const source = `# comment\n${first}\n${BODY}`;
      await assert.rejects(compileDiagram(source), (error) => {
        assert.match(error.message, /DiagramPlay/);
        assert.equal(error.cause.problems[0].code, 'missing-preamble');
        assert.equal(error.cause.problems[0].line, 2);
        return true;
      });
    }
    await assert.rejects(compileDiagram(`title "${header}"\n${header}\n${BODY}`), /DiagramPlay/);
  }
});

test('diagram_fences_keep_options_metadata_tokens_and_original_map_keys', async () => {
  const source = `thinkflow\n${BODY}`;
  const markdown = FENCES.map(
    (name) => `\`\`\`${name} width=wide name=flow-1\n${source}\`\`\`\n`,
  ).join('\n');
  const document = await documentEngine.parseDocument(markdown, { id: 'doc.md', pageId: 'p' });
  const before = snapshotTokens(document.tokens);
  const metadata = structuredClone(document.metadata);
  const fences = document.tokens.filter((token) => token.type === 'fence');

  assert.equal(document.metadata.diagrams.length, 1);
  assert.equal(document.metadata.diagrams[0].source, source);
  for (const token of fences) {
    assert.equal(token.content, source);
    assert.deepEqual({ ...token.meta.options }, { width: 'wide', name: 'flow-1' });
  }
  const { diagrams, assets } = await compileDiagrams([source, source]);
  const output = await documentEngine.renderDocument(document, { diagrams });

  assert.deepEqual([...diagrams.keys()], [source]);
  assert.equal(assets.size, 1);
  assert.deepEqual(
    output.diagrams.map((item) => item.status),
    ['embedded'],
  );
  assert.match(output.html, /app-width-wide/);
  assert.equal([...output.html.matchAll(/<iframe data-diagram/g)].length, 3);
  assert.doesNotMatch(output.html, /flow-1/);
  assert.deepEqual(snapshotTokens(document.tokens), before);
  assert.deepEqual(document.metadata, metadata);
});

test('diagram_fences_invalid_options_failed_and_pending_states_keep_original_names', async () => {
  for (const name of FENCES) {
    for (const options of ['name=A', 'name=a/b', 'name=', 'width=huge', 'title=x']) {
      const document = await documentEngine.parseDocument(`\`\`\`${name} ${options}\nA\n\`\`\`\n`, {
        id: 'doc.md',
      });
      assert.equal(document.metadata.diagrams.length, 0, `${name} ${options}`);
      assert.equal(document.diagnostics.length, 1, `${name} ${options}`);
    }
    const failed = `${name}\nbox a "A" icon=unsupported-icon\n`;
    const pending = `${name}\nnot compiled\n`;
    const markdown = `\`\`\`${name}\n${failed}\`\`\`\n\n\`\`\`${name}\n${pending}\`\`\`\n`;
    const document = await documentEngine.parseDocument(markdown, { id: 'doc.md', pageId: 'p' });
    const before = snapshotTokens(document.tokens);
    const { diagrams, assets } = await compileDiagrams([failed]);
    const output = await documentEngine.renderDocument(document, { diagrams });

    assert.deepEqual([...diagrams.keys()], [failed]);
    assert.match(diagrams.get(failed).error, /unsupported-icon/);
    assert.equal(assets.size, 0);
    assert.deepEqual(
      output.diagrams.map((item) => item.status),
      ['failed', 'pending'],
    );
    assert.deepEqual(
      output.diagnostics.map((item) => item.component),
      [name],
    );
    assert.match(output.html, /unsupported-icon/);
    assert.match(output.html, /not compiled/);
    assert.deepEqual(snapshotTokens(document.tokens), before);
  }
});

test('compileDiagram_host_full_catalog_supports_the_existing_icon_names', async () => {
  const names = ['apigw', 'code-review', 'document', 'notify', 'person', 'search', 'server'];
  const catalog = getIconCatalog();
  for (const name of names) {
    assert.ok(catalog.icons[name] || catalog.aliases[name], name);
    assert.match(readIcon(name), /<svg/);
  }
  const source = `diagramplay\n${names.map((name, index) => `box a${index} "${name}" icon=${name}`).join('\n')}\n`;
  const result = await compileDiagram(source);
  assertPlayerSource(result.html.toString(), source);
});

test('toHtml_source_override_handles_defaults_empty_and_unsafe_text_without_model_mutation', async () => {
  const source = `diagramplay\n${BODY}`;
  const built = await buildFigure(source, { allowFileAccess: false });
  const before = structuredClone(built);
  assertPlayerSource(await toHtml(built, 'Mini'), source);
  assertPlayerSource(await toHtml(built, 'Mini', { source: undefined }), source);
  for (const override of ['', '</script><img src=x>&\u2028\u2029"\r\n']) {
    const html = await toHtml(built, 'Mini', { source: override });
    assertPlayerSource(html, override);
    if (override) assert.doesNotMatch(html, /<img src=x>/);
  }
  for (const override of [null, 1, false, {}, []]) {
    await assert.rejects(toHtml(built, 'Mini', { source: override }), TypeError);
  }
  assert.deepEqual(built, before);
});
