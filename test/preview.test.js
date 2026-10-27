// 브라우저 미리보기 출력: 사이트 출력과 같은 규칙·구성 요소를 쓰고 Node 모듈을 불러오지 않는다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as ui from '@woonyong-choi/design-tokens/components';
import { parseDocument, renderDocument } from 'document-engine';
import { parseDocumentSync, renderPreview } from 'document-engine/preview';

const SOURCE = [
  '# 제목',
  '',
  '첫 문단의 **굵은 글자**와 [링크](https://example.com)',
  '',
  '> 인용',
  '',
  '![그림 설명](/assets/cover.png)',
  '',
  '```',
  '코드',
  '```',
  '',
].join('\n');

test('preview_matches_site_output_for_plain_markdown_figures_and_code', async () => {
  const site = await renderDocument(await parseDocument(SOURCE, { id: 'post' }), { id: 'post' });
  const preview = renderPreview(parseDocumentSync(SOURCE, { id: 'post' }), { ui });
  assert.equal(preview.html, site.html);
  assert.match(preview.html, new RegExp(`<figure class="${ui.FIGURE_CLASS}">`));
  assert.doesNotMatch(preview.html, /<p><img/);
  assert.deepEqual(preview.diagnostics, []);
});

test('preview_shows_code_without_highlighting_in_the_same_code_block', () => {
  const { html } = renderPreview(parseDocumentSync('```js\nconst a = 1;\n```\n', { id: 'post' }), {
    ui,
  });
  assert.match(html, /const a = 1;/);
  assert.doesNotMatch(html, /<span class="[^"]*syntax/);
});

test('preview_requires_a_parsed_document_and_the_design_ui', () => {
  assert.throws(() => renderPreview({}, { ui }), TypeError);
  assert.throws(() => renderPreview(parseDocumentSync('x', { id: 'a' }), {}), TypeError);
});

test('preview_module_graph_imports_no_node_builtins_or_highlighters', () => {
  const seen = new Set();
  const visit = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = readFileSync(url, 'utf8');
    for (const [, target] of source.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
      assert.ok(
        !/^node:|^(?:shiki|highlight\.js)$/.test(target),
        `${url.pathname} imports ${target}`,
      );
      if (target.startsWith('.')) visit(new URL(target, url));
    }
  };
  visit(new URL('../preview/index.js', import.meta.url));
  assert.ok(seen.size > 3);
});
