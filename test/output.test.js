// 오류 진단과 출력 안전성, 코드 강조, 호스트 출력 설정. 홈페이지 원본 없이 CI에서 실행한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { documentEngine } from '../index.js';

import {
  DOCUMENTS,
  ENGINE_ERROR_CASES,
  ERROR_CASES,
  UI_ERROR_CASES,
  UI_SYNTAX_ERRORS,
} from './fixtures/documents.js';
import { assets } from './support/synthetic.js';

const parse = (source, context = {}) =>
  documentEngine.parseDocument(source, { id: 'doc.md', pageId: 'p', assets, ...context });
const render = (document, context = {}) =>
  documentEngine.renderDocument(document, { assets, ...context });

const CUSTOM_CALLOUT = {
  components: {
    callout: {
      open: ({ title, tone }, kit) =>
        `<section class="mine" data-tone="${kit.escape(tone)}"><h4>${kit.escape(title)}</h4>`,
      close: () => '</section>',
    },
  },
};

// 홈페이지 원본 없이 CI가 실행하는 오류 사례 시험. 기대 문구는 원본 DirectiveError와 같은 형식(`본문 N줄 :이름: 내용`)으로 조립해 비교한다.
const located = ({ line, directive, message }) =>
  `${[line ? `본문 ${line}줄` : '', directive ? `:${directive}` : ''].filter(Boolean).join(' ')}: ${message}`;

for (const [name, source, pattern] of [...ERROR_CASES, ...ENGINE_ERROR_CASES]) {
  test(`error_case_is_a_located_diagnostic_${name}`, async () => {
    const document = await parse(source);
    const [first] = document.diagnostics;
    assert.ok(first, `a diagnostic is expected: ${name}`);
    assert.equal(first.severity, 'error');
    assert.equal(first.stage, 'parse');
    assert.equal(first.document, 'doc.md');
    assert.match(located(first), pattern);
    assert.ok((await render(document)).html.length > 0);
  });
}

for (const [name, source, pattern] of UI_ERROR_CASES) {
  test(`ui_error_case_is_a_diagnostic_${name}`, async () => {
    const document = await parse(source);
    const output = await render(document);
    const [first] = [
      ...document.diagnostics,
      ...output.diagnostics.filter((item) => item.stage === 'render'),
    ];
    assert.ok(first, `a diagnostic is expected: ${name}`);
    assert.equal(first.line, 1, name);
    assert.match(first.message, pattern);
    assert.match(output.html, /문서 오류/);
  });
}

for (const [name, source, pattern] of UI_SYNTAX_ERRORS) {
  test(`ui_syntax_error_is_one_parse_diagnostic_${name}`, async () => {
    const { diagnostics } = await parse(source);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].severity, 'error');
    assert.equal(diagnostics[0].stage, 'parse');
    assert.match(diagnostics[0].message, pattern);
  });
}

test('raw_html_and_unsafe_urls_never_reach_the_output_as_markup', async () => {
  for (const name of ['raw_html_and_unsafe_urls', 'safe_details_and_unsafe_variants']) {
    const { html, diagnostics } = await render(await parse(DOCUMENTS[name]));
    assert.deepEqual(diagnostics, [], name);
    assert.doesNotMatch(html, /href="(?:javascript|data|vbscript|file):/i, name);
    assert.doesNotMatch(html, /src="(?:javascript|data|vbscript|file):/i, name);
    assert.doesNotMatch(html, /<script/i, name);
    assert.doesNotMatch(html, /<img[^>]*onerror|<[a-z]+[^>]*\son[a-z]+=/i, name);
    assert.doesNotMatch(html, /<div>/, name);
  }
});

test('a_failing_indented_code_block_replacement_reports_its_line', async () => {
  const theme = {
    components: {
      code: () => {
        throw new Error('code failed');
      },
    },
  };
  const { diagnostics } = await render(await parse('문단\n\n    들여쓴 코드\n'), { theme });
  assert.deepEqual(
    diagnostics.map(({ component, line }) => [component, line]),
    [['code', 3]],
  );
});

test('ui_type_errors_never_reach_the_output_as_javascript_messages_or_object_text', async () => {
  for (const source of [
    '```ui:syntax-examples\nitems: 3\n```\n',
    '```ui:callout\nbody: {a: 1}\n```\n',
    '```ui:definitions\nitems:\n  - term: a\n    body: {b: 1}\n```\n',
  ]) {
    const { html, diagnostics } = await render(await parse(source));
    assert.doesNotMatch(html, /\[object Object\]|is not a function/, source);
    assert.ok(
      diagnostics.every((item) => item.stage === 'parse'),
      source,
    );
  }
});

// #23 코드 강조 시간 제한: 한 블록의 TextMate 분석이 제한을 넘으면 escape한 원문을 낸다.
test('a_code_block_over_the_highlight_time_limit_is_output_as_escaped_source', async () => {
  const line = 'const task = { title: "<Read>", done: false }; // 주석 & 끝\n';
  const source = line.repeat(40000);
  const document = await parse(`\`\`\`javascript\n${source}\`\`\`\n`);
  const started = performance.now();
  const { html, diagnostics } = await render(document);
  const elapsed = performance.now() - started;
  assert.deepEqual(diagnostics, []);
  assert.doesNotMatch(html, /app-syntax-/);
  assert.ok(
    html.includes(
      `<code class="language-javascript">${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}`,
    ),
  );
  assert.ok(elapsed < 3000, `render took ${Math.round(elapsed)}ms`);
  // 같은 언어의 짧은 블록은 계속 강조한다.
  const short = await render(await parse(`\`\`\`javascript\n${line}\`\`\`\n`));
  assert.match(short.html, /app-syntax-/);
});

test('only_the_grammars_a_document_uses_are_loaded', async () => {
  const { loadHighlighter } = await import('../renderer/code-highlight.js');
  const highlighter = await loadHighlighter();
  const ui = {
    escape: (text) => text,
    SyntaxToken: ({ text, role }) => `[${role ?? '-'}:${text}]`,
  };
  assert.equal(highlighter.highlightCode('fn main() {}', 'rust', ui), 'fn main() {}');
  await highlighter.prepare(['rust']);
  assert.match(highlighter.highlightCode('fn main() {}', 'rust', ui), /\[keyword:fn\]/);
});

// #24 교체 테마와 호스트 설정
test('a_replacement_theme_without_a_name_is_reported_as_custom', async () => {
  const document = await parse(':::note\n본문\n:::\n');
  assert.equal((await render(document)).theme, 'default');
  assert.equal((await render(document, { theme: CUSTOM_CALLOUT })).theme, 'custom');
  assert.equal(
    (await render(document, { theme: { ...CUSTOM_CALLOUT, name: 'mine' } })).theme,
    'mine',
  );
});

test('replacement_props_are_raw_text_so_the_theme_escapes_them', async () => {
  const seen = [];
  const theme = {
    components: {
      callout: {
        open: (props, kit) => {
          seen.push(props.title);
          return `<section><h4>${kit.escape(props.title)}</h4>`;
        },
        close: () => '</section>',
      },
    },
  };
  const { html } = await render(await parse(':::note[<b>&제목</b>]\n본문\n:::\n'), { theme });
  assert.deepEqual(seen, ['<b>&제목</b>']);
  assert.match(html, /<h4>&lt;b&gt;&amp;제목&lt;\/b&gt;<\/h4>/);
});

test('callout_titles_default_to_the_same_korean_label_for_directives_and_ui', async () => {
  const { html } = await render(await parse(':::note\n가\n:::\n\n```ui:callout\nbody: 나\n```\n'));
  assert.equal((html.match(/<strong>참고<\/strong>/g) ?? []).length, 2);
  assert.doesNotMatch(html, />Note</);
});

test('device_overlay_and_code_aliases_come_from_the_host_render_context', async () => {
  const document = await parse(
    '::video{src=3-upcoming-iphone.mp4 poster=3-upcoming-iphone.png alt=a frame=iphone}\n\n```run-python\nprint(1)\n```\n',
  );
  const plain = await render(document);
  assert.doesNotMatch(plain.html, /app-device-overlay/);
  assert.match(plain.html, /<span class="app-tool-label">Plain text<\/span>/);
  const hosted = await render(document, {
    deviceOverlay: 'frame.svg',
    codeAliases: { 'run-python': { language: 'python', label: 'Python · 실행 미지원' } },
  });
  assert.match(hosted.html, /class="app-device-overlay" src="\/assets\/frame\.svg"/);
  assert.match(hosted.html, /Python · 실행 미지원/);
  assert.match(hosted.html, /class="language-python"/);
});

test('card_variants_come_from_the_design_package_including_summary', async () => {
  const { diagnostics, html } = await render(
    await parse(':::cards{variant=summary}\n::card{title=가 href=/a/ description=요약}\n:::\n'),
  );
  assert.deepEqual(diagnostics, []);
  assert.match(html, /app-card-summary/);
});

// #25 옛 문법: 옛 펜스 이름, 옛 `::::tabs`+`:::tab[이름]`, 옛 붙임·약칭 옵션은 현재 문법의 일반 규칙으로 처리한다.
test('old_tab_sets_and_old_options_are_ordinary_syntax_errors', async () => {
  const cases = [
    ['::::tabs\n:::tab[A]\n가\n:::\n::::\n', 1, /^블록 줄 형식이 잘못되었습니다/],
    [':::tab[A]\n가\n:::\n', 1, /^알 수 없는 블록입니다/],
    ['::::platform[기기]\n:::tab[Mac]\n가\n:::\n::::\n', 1, /^블록 줄 형식이 잘못되었습니다/],
    [
      ':::tabs selector-segmented\n@tab A\n\n가\n\n:::end\n',
      1,
      /^허용하지 않는 속성입니다: selector-segmented/,
    ],
    [':::tabs box\n@tab A\n\n가\n\n:::end\n', 1, /^허용하지 않는 속성입니다: box/],
    [':::tabs top segmented\n@tab A\n\n가\n\n:::end\n', 1, /^허용하지 않는 속성입니다: top/],
    ['::figure w-narrow src=2-today-mac.png alt=a\n', 1, /^허용하지 않는 속성입니다: w-narrow/],
    [
      ':::cards centered\n::card{title=a href=/a/}\n:::\n',
      1,
      /^허용하지 않는 속성입니다: centered/,
    ],
    ['```js width-narrow\nx\n```\n', 1, /^허용하지 않는 속성입니다: width-narrow/],
  ];
  for (const [source, line, pattern] of cases) {
    const { diagnostics } = await parse(source);
    assert.ok(diagnostics.length >= 1, source);
    assert.equal(diagnostics[0].line, line, source);
    assert.match(diagnostics[0].message, pattern, source);
  }
});

test('old_diagram_fence_names_are_plain_code_and_their_options_are_code_options', async () => {
  for (const name of ['thinkflow', 'torso']) {
    const plain = await parse(`\`\`\`${name}\nA\n\`\`\`\n`);
    assert.deepEqual(plain.diagnostics, [], name);
    assert.deepEqual(plain.metadata.diagrams, [], name);
    assert.equal(plain.tokens[0].meta.role, 'code', name);
    const named = await parse(`\`\`\`${name} name=flow\nA\n\`\`\`\n`);
    assert.match(named.diagnostics[0].message, /^허용하지 않는 속성입니다: name/, name);
  }
});
