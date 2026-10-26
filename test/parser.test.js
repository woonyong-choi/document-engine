// 해석기: HTML·테마 없이 구조·원문 위치·진단을 만든다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import katex from 'katex';

import { parseDocumentSync as parseDocument } from '../parser/index.js';

import { DOCUMENTS } from './fixtures/documents.js';
import { assets } from './support/synthetic.js';
import { snapshotTokens } from './support/snapshot.js';

const parse = (source, context = {}) =>
  parseDocument(source, { id: 'doc.md', pageId: 'p', assets, ...context });

function allTokens(tokens) {
  return tokens.flatMap((token) => [
    token,
    ...allTokens(token.children ?? []),
    ...(token.meta?.units ?? []).flatMap((unit) => allTokens(unit.tokens)),
  ]);
}

// 정적 import(여러 줄 포함), export ... from, 동적 import()의 지정자를 모두 찾는다.
const SPECIFIERS =
  /\bimport\s*\(\s*['"]([^'"]+)['"]|\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const specifiersOf = (text) => [...text.matchAll(SPECIFIERS)].map((match) => match[1] ?? match[2]);

test('import_scan_finds_multi_line_static_reexport_and_dynamic_imports', () => {
  const text = [
    "import {\n  a,\n  b,\n} from '@woonyong-choi/design-tokens/components';",
    "export { c } from './c.js';",
    "const d = await import('shiki');",
    "import 'side-effect';",
  ].join('\n');
  assert.deepEqual(specifiersOf(text), [
    '@woonyong-choi/design-tokens/components',
    './c.js',
    'shiki',
    'side-effect',
  ]);
});

test('parser_sources_do_not_import_the_renderer_theme_design_or_output_libraries', () => {
  const forbidden = [
    /renderer\//,
    /theme\//,
    /dist\//,
    /@woonyong-choi\/design-tokens/,
    /diagramplay/,
    /highlight\.js/,
    /shiki/,
    /^katex(?:\/|$)/,
  ];
  const imports = [];
  const dir = new URL('../parser/', import.meta.url);
  for (const file of readdirSync(dir)) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    for (const specifier of specifiersOf(text)) imports.push([file, specifier]);
  }
  assert.ok(imports.length > 5);
  for (const [file, specifier] of imports) {
    assert.ok(
      !forbidden.some((pattern) => pattern.test(specifier)),
      `${file} imports ${specifier}`,
    );
  }
});

test('parseDocument_never_creates_html_tokens_or_calls_the_math_renderer', () => {
  const original = katex.renderToString;
  katex.renderToString = () => {
    throw new Error('the parser must not render math');
  };
  try {
    for (const [name, source] of Object.entries(DOCUMENTS)) {
      const tokens = allTokens(parse(source).tokens);
      const html = tokens.filter((token) => token.type.startsWith('html_'));
      assert.deepEqual(html, [], name);
      // 의미 토큰은 HTML 대신 상태만 갖는다.
      for (const token of tokens.filter((item) => /^(?:directive_inline|task_)/.test(item.type))) {
        assert.equal(token.content, '', `${name}: ${token.type}`);
      }
    }
  } finally {
    katex.renderToString = original;
  }
});

test('inline_directives_keep_name_label_attrs_and_plain_text_instead_of_html', () => {
  const document = parse('열기 :icon[search] :kbd[⌘ K] :tip[단어]{text=설명}');
  const inline = document.tokens.find((token) => token.type === 'inline');
  const directives = inline.children.filter((token) => token.type === 'directive_inline');
  assert.deepEqual(
    directives.map((token) => [token.meta.name, token.meta.label, token.meta.plainText]),
    [
      ['icon', 'search', 'search'],
      ['kbd', '⌘ K', '⌘ K'],
      ['tip', '단어', '단어'],
    ],
  );
  assert.equal(directives[2].meta.attrs.text, '설명');
  assert.equal(directives[2].content, '');
});

test('task_items_become_semantic_tokens_with_states', () => {
  const document = parse('- [ ] 열림\n- [x] 완료\n- [~] 취소\n');
  const items = document.tokens.filter((token) => token.type === 'list_item_open');
  assert.deepEqual(
    items.map((token) => token.meta.task),
    ['todo', 'done', 'cancelled'],
  );
  const kinds = allTokens(document.tokens).map((token) => token.type);
  assert.equal(kinds.filter((type) => type === 'task_checkbox').length, 2);
  assert.equal(kinds.filter((type) => type === 'task_cancelled').length, 1);
  assert.equal(kinds.filter((type) => type === 'task_label_open').length, 2);
});

test('ui_fences_keep_yaml_data_and_pre_parsed_nested_markdown_without_reparsing_at_output', () => {
  const source =
    '```ui:tabs\nitems:\n  - { label: A, body: "**가**" }\n  - { label: B, body: "나[^1]\\n\\n[^1]: 각주" }\n```\n';
  const document = parse(source);
  const [fence] = document.tokens;
  assert.equal(fence.meta.role, 'ui');
  assert.equal(fence.meta.kind, 'tabs');
  assert.equal(fence.meta.data.items[0].label, 'A');
  assert.deepEqual(
    fence.meta.units.map((unit) => unit.path),
    ['items.0.body', 'items.1.body'],
  );
  assert.ok(fence.meta.units[0].tokens.some((token) => token.type === 'inline'));
  assert.ok(fence.meta.units[1].env.footnotes.list.length === 1);
  assert.match(fence.meta.id, /^component-p-\d+$/);
  assert.equal(fence.meta.units[0].env.docId, `${fence.meta.id}-1`);
});

test('diagramplay_sources_are_collected_at_parse_time_with_lines_and_options', () => {
  const source =
    '문단\n\n```diagramplay width=wide\nA\n```\n\n```diagramplay width=wide\nA\n```\n\n```ui:callout\ntitle: x\nbody: "```diagramplay\\nB\\n```"\n```\n';
  const { metadata } = parse(source);
  assert.deepEqual(
    metadata.diagrams.map(({ source: text, line, width }) => [text, line, width]),
    [
      ['A\n', 3, 'wide'],
      ['B\n', 11, undefined],
    ],
  );
});

test('diagramplay_name_is_accepted_validated_and_kept_only_in_the_fence_options', () => {
  const fenceOf = (info) => {
    const document = parse(`\`\`\`${info}\nA\n\`\`\`\n`);
    return { fence: allTokens(document.tokens).find((token) => token.type === 'fence'), document };
  };
  assert.deepEqual(
    { ...fenceOf('diagramplay name=arch-v1').fence.meta.options },
    { name: 'arch-v1' },
  );
  assert.deepEqual(
    { ...fenceOf('diagramplay width=wide name=flow').fence.meta.options },
    { width: 'wide', name: 'flow' },
  );
  assert.equal(fenceOf('diagramplay name=flow').fence.info.trim(), 'diagramplay name=flow');
  for (const info of [
    'diagramplay name=a/b',
    'diagramplay name=../x',
    'diagramplay name=',
    'diagramplay name',
  ]) {
    const { fence, document } = fenceOf(info);
    assert.equal(fence.meta.role, 'error', info);
    assert.ok(document.diagnostics.length > 0, info);
  }
  const unknown = fenceOf('diagramplay name=ok title=x');
  assert.equal(unknown.fence.meta.role, 'error');
  assert.match(unknown.document.diagnostics[0].message, /허용하지 않는 속성/);
  // 이름이 달라도 같은 원문은 한 번만 모으고, 이름은 도표 원문과 모은 정보에 섞지 않는다.
  const { metadata } = parse(
    '```diagramplay name=one\nA\n```\n\n```diagramplay name=two\nA\n```\n',
  );
  assert.deepEqual(metadata.diagrams, [{ source: 'A\n', line: 1, width: undefined }]);
});

test('headings_keep_source_lines_ids_and_nested_titles', () => {
  const { metadata } = parse(
    '# 하나\n\n본문\n\n## 둘 **굵게**\n\n```ui:details\ntitle: t\nbody: "### 안쪽 제목"\n```\n',
  );
  assert.deepEqual(
    metadata.headings.map(({ id, title, level, line }) => [id, title, level, line]),
    [
      ['p-하나', '하나', 1, 1],
      ['p-둘-굵게', '둘 굵게', 2, 5],
      ['p-안쪽-제목', '안쪽 제목', 3, 7],
    ],
  );
});

test('block_tokens_keep_source_line_ranges', () => {
  const document = parse('문단\n\n:::note\n본문\n:::\n\n::figure{src=2-today-mac.png alt=a}\n');
  const open = document.tokens.find((token) => token.type === 'directive_open');
  const leaf = document.tokens.find((token) => token.type === 'directive');
  assert.deepEqual(open.map, [2, 4]);
  assert.deepEqual(leaf.map, [6, 7]);
});

test('syntax_errors_return_located_diagnostics_and_keep_the_rest_of_the_document', () => {
  const source =
    '앞 문단\n\n:::note\n열림\n\n::figure{src=nope.png alt=a}\n\n뒤 문단 :icon[search]\n';
  const document = parse(source, { icons: { has: (name) => name === 'search' } });
  // 닫는 줄을 못 찾은 블록은 여는 줄만 오류로 소비하고, 뒤의 없는 자산은 따로 보고한다.
  assert.deepEqual(
    document.diagnostics.map(({ line }) => line),
    [3, 6],
  );
  assert.deepEqual(
    { ...document.diagnostics[0] },
    {
      document: 'doc.md',
      severity: 'error',
      stage: 'parse',
      message: '닫는 ::: 줄이 없습니다',
      line: 3,
      directive: 'note',
    },
  );
  const texts = allTokens(document.tokens)
    .filter((token) => token.type === 'text')
    .map((token) => token.content);
  assert.ok(texts.includes('앞 문단'));
  assert.ok(texts.some((text) => text.startsWith('뒤 문단')));
});

test('an_error_inside_a_nested_block_becomes_one_error_token_and_keeps_its_parent_valid', () => {
  const source =
    ':::tabs\n@tab A\n\n::figure{src=nope.png alt=a}\n\n정상\n\n@tab B\n\n나\n\n:::end\n';
  const document = parse(source);
  assert.deepEqual(
    document.diagnostics.map(({ line, message }) => [line, message]),
    [[4, 'src: 없는 자산입니다: nope.png']],
  );
  const kinds = document.tokens.map((token) => token.type);
  assert.ok(kinds.includes('directive_error'));
  assert.equal(kinds.filter((type) => type === 'directive_open').length, 3);
});

test('inline_errors_keep_the_original_text_and_record_the_line', () => {
  const document = parse('첫 줄\n\n:tip[단어]를 읽습니다.\n');
  assert.equal(document.diagnostics[0].line, 3);
  assert.equal(document.diagnostics[0].directive, 'tip');
  const inline = document.tokens.filter((token) => token.type === 'inline')[1];
  assert.equal(inline.children[0].content, ':tip[단어]를 읽습니다.');
});

test('nested_component_errors_point_to_the_component_line_and_keep_the_inner_line', () => {
  const source = '문단\n\n```ui:callout\ntitle: x\nbody: ":tip[단어]"\n```\n';
  const [diagnostic] = parse(source).diagnostics;
  assert.equal(diagnostic.line, 3);
  assert.equal(diagnostic.nestedLine, 1);
  assert.equal(diagnostic.directive, 'tip');
});

test('unknown_components_and_bad_yaml_are_diagnosed_with_lines', () => {
  const unknown = parse('문단\n\n```ui:nope\nbody: x\n```\n');
  assert.deepEqual(
    [unknown.diagnostics[0].line, unknown.diagnostics[0].message],
    [3, 'Unknown document component: nope'],
  );
  const yaml = parse('```ui:tabs\nitems: [\n```\n');
  assert.equal(yaml.diagnostics.length, 1);
  assert.equal(yaml.diagnostics[0].line >= 1, true);
  assert.match(yaml.diagnostics[0].message, /ui:tabs/);
});

test('validation_functions_are_optional_and_only_checked_when_the_caller_supplies_them', () => {
  const source = '::figure{src=missing.png alt=a href="javascript:x"}\n:icon[nope]\n';
  assert.equal(parseDocument(source, { id: 'a' }).diagnostics.length, 0);
  const checked = parseDocument(source, {
    id: 'a',
    assets: { exists: () => false },
    urls: { isSafe: () => false },
    icons: { has: () => false },
  });
  assert.ok(checked.diagnostics.length >= 1);
});

test('parseDocument_rejects_non_string_sources_missing_ids_and_unsafe_page_ids', () => {
  assert.throws(() => parseDocument(42, { id: 'a' }), TypeError);
  assert.throws(() => parseDocument('x', { id: 'a', pageId: '../x' }), /pageId/);
  for (const context of [undefined, {}, { id: '' }, { id: 1 }]) {
    assert.throws(() => parseDocument('x', context), /context\.id/);
  }
});

test('the_same_source_always_parses_to_the_same_structure', () => {
  for (const [name, source] of Object.entries(DOCUMENTS)) {
    assert.deepEqual(
      snapshotTokens(parse(source).tokens),
      snapshotTokens(parse(source).tokens),
      name,
    );
  }
});

test('the_source_string_is_never_modified_by_parsing', () => {
  const source = '## 제목\r\n\r\n:::note\r\n본문\r\n:::\r\n';
  const copy = `${source}`;
  parse(source);
  assert.equal(source, copy);
});

test('fineprint_null_body_is_an_empty_inline_but_other_components_keep_null_as_text', () => {
  const fineprint = parse('```ui:fineprint\nbody: null\n```\n');
  assert.deepEqual(fineprint.diagnostics, []);
  const [unit] = fineprint.tokens[0].meta.units;
  assert.equal(unit.inline, true);
  assert.equal(unit.tokens[0].content, '');
  const callout = parse('```ui:callout\ntitle: t\nbody: null\n```\n');
  const inline = callout.tokens[0].meta.units[0].tokens.find((token) => token.type === 'inline');
  assert.equal(inline.content, 'null');
});

test('details_summary_inline_errors_report_the_summary_line', () => {
  const document = parse('문단\n\n<details>\n<summary>:tip[설명]</summary>\n본문\n</details>\n');
  assert.equal(document.diagnostics.length, 1);
  assert.equal(document.diagnostics[0].line, 4);
  assert.equal(document.diagnostics[0].directive, 'tip');
  const first = parse('<details>\n<summary>:tip[설명]</summary>\n본문\n</details>\n');
  assert.equal(first.diagnostics[0].line, 2);
});

// DiagramPlay의 이름 규칙은 공개 진입점인 CLI(`diagramplay md --check --json`)로 확인한다. 내부 파일은 읽지 않는다.
test('diagramplay_name_validity_matches_the_pinned_diagramplay_markdown_check', () => {
  const names = [
    'flow',
    'a-b',
    'a1',
    'a-1-b',
    'A',
    'a_b',
    '-a',
    'a-',
    'a--b',
    'a.b',
    '한글',
    'a/b',
    '../x',
  ];
  const blocks = names.map(
    (name) => `\`\`\`diagramplay name=${name}\ndiagramplay\nbox a "A"\n\`\`\``,
  );
  const markdown = `${blocks.join('\n\n')}\n`;
  const pkg = createRequire(import.meta.url).resolve('diagramplay/package.json');
  const cli = join(dirname(pkg), JSON.parse(readFileSync(pkg, 'utf8')).bin.diagramplay);
  // 검사 입력은 저장소 규칙대로 .local/ 아래에 두고 끝나면 지운다.
  const dir = new URL('../.local/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = fileURLToPath(new URL('diagramplay-names.md', dir));
  writeFileSync(file, markdown);
  let output = '';
  try {
    execFileSync(process.execPath, [cli, 'md', file, '--check', '--json'], { encoding: 'utf8' });
  } catch (error) {
    output = error.stdout;
  } finally {
    rmSync(file, { force: true });
  }
  const rejectedLines = new Set(
    output
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).line),
  );
  const fences = allTokens(parse(markdown).tokens).filter((token) => token.type === 'fence');
  assert.equal(fences.length, names.length);
  names.forEach((name, index) => {
    const upstreamValid = !rejectedLines.has(fences[index].map[0] + 1);
    assert.equal(fences[index].meta.role === 'diagram', upstreamValid, `name=${name}`);
  });
  assert.ok(rejectedLines.size > 0 && rejectedLines.size < names.length);
});

test('links_and_images_are_collected_with_lines_including_component_fields_and_footnotes', () => {
  const source = [
    '문단 [문서](a.md#x) ![그림](images/p.png) <https://example.com> 와 https://auto.example',
    '',
    '[앵커](#local)',
    '',
    '```ui:callout',
    'title: t',
    'body: "안쪽 [링크](inner.md)"',
    '```',
    '',
    '각주[^1]',
    '',
    '[^1]: 각주 안 [링크](note.md)',
    '',
  ].join('\n');
  const { metadata } = parse(source);
  assert.deepEqual(
    metadata.links.map(({ kind, target }) => [kind, target]),
    [
      ['link', 'a.md#x'],
      ['image', 'images/p.png'],
      ['link', 'https://example.com'],
      ['link', 'https://auto.example'],
      ['link', '#local'],
      ['link', 'note.md'], // 본문 단위의 각주 정의가 구성 요소 필드보다 먼저
      ['link', 'inner.md'],
    ],
  );
  assert.equal(metadata.links[0].line, 1);
  assert.equal(metadata.links[4].line, 3);
  // 줄바꿈이 있는 문단 안에서는 링크가 있는 줄을 가리킨다.
  const wrapped = parse('첫 줄\n둘째 [링크](b.md)\n셋째 ![그림](c.png)\n').metadata.links;
  assert.deepEqual(
    wrapped.map(({ target, line }) => [target, line]),
    [
      ['b.md', 2],
      ['c.png', 3],
    ],
  );
  assert.deepEqual(parse('링크 없음\n').metadata.links, []);
});

test('component_hrefs_are_collected_from_directives_and_ui_components_with_their_lines', () => {
  const source = [
    ':::cards{variant=centered}',
    '::card{title="가" href=/a.md}',
    '::card{title="나" href=https://example.com/b}',
    ':::end',
    '',
    '::figure{src=x.png alt=a href=/c.md}',
    '',
    '```ui:cards',
    'variant: grouped',
    'items:',
    '  - title: t',
    '    href: /d.md',
    '```',
    '',
    '```ui:feature',
    'title: t',
    'description: d',
    'href: /e.md',
    'body: 본문 [안쪽](f.md)',
    '```',
    '',
  ].join('\n');
  const { metadata, diagnostics } = parse(source, { assets: undefined });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    metadata.links.map(({ target, line }) => [target, line]),
    [
      ['/a.md', 2],
      ['https://example.com/b', 3],
      ['/c.md', 6],
      ['/d.md', 8],
      ['/e.md', 15],
      ['f.md', 15],
    ],
  );
});

test('links_in_nested_component_fields_stay_on_the_fence_line_while_plain_text_counts_its_own_lines', () => {
  const source = [
    '앞 문단',
    '',
    '```ui:callout',
    'title: t',
    'body: "첫 줄\\n[없음](gone.md)\\n셋째 ![그림](g.png)"',
    '```',
    '',
    '본문 첫 줄',
    '둘째 [밖](out.md)',
    '',
  ].join('\n');
  const { metadata } = parse(source);
  assert.deepEqual(
    metadata.links.map(({ target, line }) => [target, line]),
    [
      ['out.md', 9],
      ['gone.md', 3],
      ['g.png', 3],
    ],
  );
});

// #22 해석 경계: 문서 안 DOM id 유일성, 줄 첫머리 강조, 진단 위치, 작업 항목, ui 데이터 형식.
const domIds = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const renderIds = async (source, context = {}) => {
  const { documentEngine } = await import('../index.js');
  const document = await documentEngine.parseDocument(source, { id: 'doc.md', ...context });
  return domIds((await documentEngine.renderDocument(document)).html);
};
const duplicates = (ids) => ids.filter((id, index) => ids.indexOf(id) !== index);

test('a_tip_inside_an_inline_field_and_a_later_component_get_distinct_ids', async () => {
  const source =
    "```ui:fineprint\nbody: 'a :tip[팁]{text=설명}'\n```\n\n```ui:tooltip\nlabel: x\ntext: y\n```\n";
  for (const pageId of [undefined, 'p']) {
    const ids = await renderIds(source, { pageId });
    assert.ok(ids.length >= 2, String(pageId));
    assert.deepEqual(duplicates(ids), [], String(pageId));
  }
});

test('heading_ids_without_a_page_id_never_take_a_component_id', async () => {
  const source =
    '# Component Page 1\n\n## Component Page 2 Tip\n\n```ui:callout\ntitle: t\nbody: b\n```\n\n```ui:tooltip\nlabel: x\ntext: y\n```\n';
  const ids = await renderIds(source);
  assert.deepEqual(duplicates(ids), []);
  assert.ok(ids.includes('component-page-2-tip'));
  const { metadata } = parseDocument(source, { id: 'doc.md' });
  assert.deepEqual(
    metadata.headings.map((heading) => heading.id),
    ['heading-component-page-1', 'heading-component-page-2-tip'],
  );
});

test('a_highlight_at_the_start_of_a_line_closed_on_the_same_line_is_text_not_a_block', () => {
  const document = parse('intro line\n::important stuff:: more\n\n::name text::\n');
  assert.deepEqual(document.diagnostics, []);
  const marks = allTokens(document.tokens).filter((token) => token.type === 'mark_open');
  assert.equal(marks.length, 2);
  const texts = allTokens(document.tokens)
    .filter((token) => token.type === 'text')
    .map((token) => token.content);
  assert.ok(texts.includes('intro line'));
  assert.ok(texts.includes(' more'));
});

test('a_closing_line_right_after_a_paragraph_is_diagnosed_not_kept_as_text', () => {
  for (const [source, line, pattern] of [
    ['문단\n:::\n', 2, /여는 줄 없이 닫는 줄이 있습니다/],
    ['문단\n:::end\n', 2, /여는 블록 없이 :::end 가 있습니다/],
    ['문단\n:::  note\n', 2, /블록 줄 형식이 잘못되었습니다/],
  ]) {
    const document = parse(source);
    assert.equal(document.diagnostics.length, 1, source);
    assert.equal(document.diagnostics[0].line, line, source);
    assert.match(document.diagnostics[0].message, pattern, source);
  }
});

test('a_reference_definition_named_like_a_task_marker_keeps_the_item_a_task_without_a_link', () => {
  const document = parse('- [x] done\n- [ ] open\n\n[x]: /url\n[ ]: /other\n');
  const items = document.tokens.filter((token) => token.type === 'list_item_open');
  assert.deepEqual(
    items.map((token) => token.meta?.task),
    ['done', 'todo'],
  );
  const kinds = allTokens(document.tokens).map((token) => token.type);
  assert.equal(kinds.filter((type) => type === 'link_open').length, 0);
  assert.deepEqual(document.metadata.links, []);
  const inlines = document.tokens.filter((token) => token.type === 'inline').slice(0, 2);
  assert.deepEqual(
    inlines.map((token) => token.children.at(-2).content),
    [' done', ' open'],
  );
});

test('inline_errors_point_to_the_line_inside_the_paragraph', () => {
  const plain = parse('첫 줄\n둘째 :tip[단어]\n');
  assert.equal(plain.diagnostics[0].line, 2);
  const marked = parse('첫 줄\n둘째\n셋째 ::강조 :tip[단어]::\n');
  assert.equal(marked.diagnostics[0].line, 3);
  const nested = parse('```ui:callout\ntitle: t\nbody: "첫 줄\\n둘째 :tip[x]"\n```\n');
  assert.equal(nested.diagnostics[0].line, 1);
  assert.equal(nested.diagnostics[0].nestedLine, 2);
});

test('ui_field_types_are_checked_at_parse_time_with_the_field_line', () => {
  const cases = [
    ['```ui:syntax-examples\nitems: 3\n```\n', 2, /^items: 항목 목록이어야 합니다$/],
    ['```ui:callout\ntitle: t\nbody: {a: 1}\n```\n', 3, /^body: 글이어야 합니다$/],
    [
      '```ui:tabs\nitems:\n  - label: A\n    body: [1]\n```\n',
      4,
      /^items\.0\.body: 글이어야 합니다$/,
    ],
    ['```ui:cards\nitems:\n  - 3\n```\n', 3, /^items\.0: 항목/],
    ['```ui:callout\ntitle: [x]\nbody: b\n```\n', 2, /^title: 글이어야 합니다$/],
    ['```ui:feature-list\ntitle: t\n```\n', 1, /^필수 필드가 없습니다: items$/],
  ];
  for (const [source, line, pattern] of cases) {
    const document = parse(`문단\n\n${source}`);
    assert.equal(document.diagnostics.length, 1, source);
    const [diagnostic] = document.diagnostics;
    assert.equal(diagnostic.stage, 'parse', source);
    assert.match(diagnostic.message, pattern, source);
    assert.equal(diagnostic.line, line + 2, source);
    assert.equal(document.tokens.at(-1).meta.role, 'error', source);
  }
});
