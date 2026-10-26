// 렌더러와 테마 계약: 같은 해석 결과를 여러 번·다른 테마로 그려도 문서가 변하지 않고, 교체와 실패가 진단으로 드러난다.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_THEME_FILES,
  MATH_STYLESHEET,
  ThemeError,
  compileDiagram,
  compileDiagrams,
  documentEngine,
  mathAssets,
} from '../index.js';

import { DOCUMENTS } from './fixtures/documents.js';
import { snapshotTokens } from './support/snapshot.js';
import { assets } from './support/synthetic.js';

const parse = (source, context = {}) =>
  documentEngine.parseDocument(source, { id: 'doc.md', pageId: 'p', assets, ...context });
const render = (document, context = {}) =>
  documentEngine.renderDocument(document, { assets, ...context });
const readdirSyncSafe = (dir) => readdirSync(new URL(`../${dir}/`, import.meta.url));
const stable = (html) => html.replace(/icon-\d+-/g, 'icon-N-');

const CUSTOM_CALLOUT = {
  components: {
    callout: {
      open: ({ title, tone }, kit) =>
        `<section class="mine" data-tone="${kit.escape(tone)}"><h4>${kit.escape(title)}</h4>`,
      close: () => '</section>',
    },
  },
};

test('render_does_not_change_the_document_and_repeats_the_same_output', async () => {
  for (const [name, source] of Object.entries(DOCUMENTS)) {
    const document = await parse(source);
    const before = snapshotTokens(document.tokens);
    const first = await render(document);
    const second = await render(document, { theme: CUSTOM_CALLOUT });
    const third = await render(document);
    assert.deepEqual(snapshotTokens(document.tokens), before, name);
    assert.equal(stable(third.html), stable(first.html), name);
    assert.equal(second.diagnostics.length, first.diagnostics.length, name);
  }
});

test('default_theme_output_is_the_same_before_and_after_a_custom_theme_render', async () => {
  const document = await parse(
    ':::note[제목]\n본문\n:::\n\n```ui:callout\ntitle: UI\nbody: 안\n```\n',
  );
  const before = (await render(document)).html;
  const custom = (await render(document, { theme: CUSTOM_CALLOUT })).html;
  const after = (await render(document)).html;
  assert.equal(before, after);
  assert.notEqual(before, custom);
});

test('theme_components_replace_html_for_directives_and_ui_components_not_only_css', async () => {
  const document = await parse(
    ':::note[제목]\n본문\n:::\n\n```ui:callout\ntitle: UI\ntone: warning\nbody: 안\n```\n',
  );
  const { html, diagnostics } = await render(document, { theme: CUSTOM_CALLOUT });
  assert.deepEqual(diagnostics, []);
  assert.match(
    html,
    /<section class="mine" data-tone=""><h4>제목<\/h4>\s*<p>본문<\/p>\s*<\/section>/,
  );
  assert.match(
    html,
    /<section class="mine" data-tone="warning"><h4>UI<\/h4><p>안<\/p>\s*<\/section>/,
  );
  assert.doesNotMatch(html, /app-callout/);
});

test('theme_replacement_receives_json_props_and_only_changes_the_chosen_component', async () => {
  const seen = [];
  const theme = {
    components: {
      card: (props, kit) => {
        seen.push(JSON.parse(JSON.stringify(props)));
        return `<a class="c" href="${kit.escape(kit.safeUrl(props.href))}">${kit.escape(props.title)}</a>`;
      },
      kbd: ({ label }, kit) => `<kbd class="k">${kit.escape(label)}</kbd>`,
    },
  };
  const document = await parse(
    ':::cards{variant=inline}\n::card{title=가 href=/a/ icon=document}\n:::\n\n:kbd[Ctrl] :menu[파일]\n',
  );
  const { html } = await render(document, { theme });
  assert.match(html, /<a class="c" href="\/a\/">가<\/a>/);
  assert.match(html, /<kbd class="k">Ctrl<\/kbd>/);
  assert.match(html, /<b class="app-menu-label">파일<\/b>/);
  assert.deepEqual(seen, [
    { title: '가', href: '/a/', icon: 'content:document', variant: 'inline' },
  ]);
});

test('unsupported_or_malformed_theme_replacements_are_rejected_not_hidden', async () => {
  const document = await parse('문단\n');
  await assert.rejects(render(document, { theme: { components: { nope: () => '' } } }), ThemeError);
  await assert.rejects(
    render(document, { theme: { components: { callout: { open: () => '' } } } }),
    /must provide close/,
  );
  await assert.rejects(
    render(document, { theme: { components: { card: 'html' } } }),
    /must be a function/,
  );
});

test('a_failing_replacement_is_a_located_diagnostic_and_shows_an_error_block', async () => {
  const theme = {
    components: {
      callout: {
        open: () => {
          throw new Error('broken theme');
        },
        close: () => '</broken>',
      },
    },
  };
  const document = await parse('앞\n\n문단\n\n:::note\n본문\n:::\n\n뒤\n');
  const { html, diagnostics } = await render(document, { theme });
  assert.deepEqual(
    diagnostics.map(({ stage, component, message, line }) => ({ stage, component, message, line })),
    [{ stage: 'render', component: 'callout.open', message: 'broken theme', line: 5 }],
  );
  assert.match(html, /문서 오류/);
  assert.match(html, /broken theme/);
  assert.doesNotMatch(html, /<\/broken>/, 'the close of a failed open must not be emitted');
  assert.match(html, /<p>뒤<\/p>/);
});

test('a_replacement_that_returns_a_non_string_is_a_diagnostic', async () => {
  const theme = { components: { kbd: () => 42 } };
  const { diagnostics, html } = await render(await parse(':kbd[x]'), { theme });
  assert.match(diagnostics[0].message, /must return an HTML string/);
  assert.match(html, /문서 오류/);
});

test('invalid_assets_and_urls_found_at_output_become_diagnostics_with_the_component_line', async () => {
  const source =
    '문단\n\n```ui:figure\nsrc: ../outside.png\nalt: x\n```\n\n```ui:figure\nsrc: 2-today-mac.png\nalt: x\nhref: "javascript:alert(1)"\n```\n';
  const { diagnostics, html } = await render(await parse(source));
  assert.deepEqual(
    diagnostics.map(({ stage, line, message }) => [stage, line, message]),
    [
      ['render', 3, 'Invalid asset: ../outside.png'],
      ['render', 8, 'Unsupported URL: javascript:alert(1)'],
    ],
  );
  assert.doesNotMatch(html, /href="javascript:/);
});

test('asset_urls_and_sizes_come_from_the_callers_resolver_and_used_assets_are_reported', async () => {
  const resolver = {
    exists: () => true,
    url: (name) => `/project-assets/${name}`,
    size: (name) => (name === '2-today-mac.png' ? [10, 20] : undefined),
  };
  const document = await parse(
    '::figure{src=2-today-mac.png alt=a}\n\n![x](/assets/2-today-mac.png)\n',
    { assets: resolver },
  );
  const output = await render(document, { assets: resolver });
  assert.match(output.html, /src="\/project-assets\/2-today-mac\.png"/);
  assert.match(output.html, /<img width="10" height="20" class="" src="\/project-assets/);
  assert.match(
    output.html,
    /<img src="\/assets\/2-today-mac\.png" alt="x" loading="lazy" decoding="async" width="10" height="20">/,
  );
  assert.deepEqual(output.assets, [
    { name: '2-today-mac.png', url: '/project-assets/2-today-mac.png' },
  ]);
});

test('runtime_entrypoints_math_flag_and_headings_come_with_the_output', async () => {
  const plain = await render(await parse('# 제목\n\n문단\n'));
  assert.deepEqual(
    [plain.runtime, plain.math, plain.headings.map((item) => item.id)],
    [[], false, ['p-제목']],
  );
  const rich = await render(
    await parse(
      ':::tabs\n@tab A\n\n$x^2$\n\n@tab B\n\n나\n\n:::end\n\n::video{src=3-upcoming-mac-2.mp4 poster=3-upcoming-mac-2.png alt=v}\n\n```js\nx\n```\n',
    ),
  );
  assert.deepEqual(rich.runtime.toSorted(), ['document.js', 'video.js']);
  assert.equal(rich.math, true);
});

test('dark_mode_is_a_theme_attribute_so_the_same_html_serves_light_and_dark', async () => {
  const output = await render(await parse(DOCUMENTS.tab_bodies_with_code_images_footnotes_and_ui));
  const tokens = readFileSync(
    new URL(DEFAULT_THEME_FILES.tokens, DEFAULT_THEME_FILES.root),
    'utf8',
  );
  assert.match(tokens, /\[data-theme='dark'\]/);
  assert.match(tokens, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(output.html, /data-theme|prefers-color-scheme|style="/);
  assert.equal(output.theme, 'default');
});

test('default_theme_files_resolve_inside_the_installed_design_package', () => {
  const design = createRequire(import.meta.url).resolve(
    '@woonyong-choi/design-tokens/package.json',
  );
  assert.equal(DEFAULT_THEME_FILES.root.href, new URL('./dist/', pathToFileURL(design)).href);
  for (const name of [
    DEFAULT_THEME_FILES.tokens,
    DEFAULT_THEME_FILES.styles,
    DEFAULT_THEME_FILES.iconCatalog,
    'ui/runtime/document.js',
  ]) {
    assert.ok(readFileSync(new URL(name, DEFAULT_THEME_FILES.root)).length > 0, name);
  }
});

test('shipped_product_code_has_no_personal_absolute_paths', () => {
  for (const dir of ['parser', 'renderer', 'theme']) {
    for (const file of readdirSyncSafe(dir)) {
      assert.doesNotMatch(
        readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8'),
        /\/Users\/|\/home\/[a-z]/,
        `${dir}/${file}`,
      );
    }
  }
  assert.doesNotMatch(readFileSync(new URL('../index.js', import.meta.url), 'utf8'), /\/Users\//);
});

test('math_assets_are_local_woff2_only', () => {
  const { assets: files } = mathAssets();
  const css = files.get(MATH_STYLESHEET).toString();
  assert.doesNotMatch(css, /https?:|\.woff\b|\.ttf|@import/);
  assert.ok(files.has('/katex/LICENSE'));
});

test('diagramplay_compiles_to_data_and_embeds_without_blocking_the_document', async () => {
  const flow =
    'diagramplay\ntitle "Mini"\nbox a "A"\nbox b "B"\na -> b "go"\n\nscene "S"\n  a -> b "x"\n';
  const first = await compileDiagram(flow);
  assert.match(first.src, /^\/diagrams\/[0-9a-f]{64}\.html$/);
  assert.equal(first.title, 'Mini');
  assert.ok(first.dimensions.width > 0 && first.html.length > 1000);
  assert.ok(
    Number.isInteger(first.scenes) && first.scenes >= 0,
    'scenes comes from the compile result',
  );
  assert.equal(
    (await compileDiagram(flow)).src,
    first.src,
    'the same source maps to the same asset',
  );

  const source = `\`\`\`diagramplay width=wide\n${flow}\`\`\`\n\n\`\`\`diagramplay\nnot a figure\n\`\`\`\n\n\`\`\`diagramplay\nnever compiled\n\`\`\`\n`;
  const document = await parse(source);
  const { diagrams, assets: files } = await compileDiagrams(
    document.metadata.diagrams.map((item) => item.source).slice(0, 2),
  );
  assert.deepEqual([...files.keys()], [first.src]);
  const output = await render(document, { diagrams });
  assert.deepEqual(
    output.diagrams.map((item) => [item.line, item.status]),
    [
      [1, 'embedded'],
      [12, 'failed'],
      [16, 'pending'],
    ],
  );
  assert.match(
    output.html,
    /<figure class="app-diagram app-width-wide"><iframe data-diagram src="\/diagrams\//,
  );
  assert.match(output.html, /language-text|Plain text/, 'a pending diagram stays readable source');
  assert.deepEqual(
    output.diagnostics.map((item) => [item.stage, item.component, item.line]),
    [['render', 'diagramplay', 12]],
  );
  // 도표 틀(diagram.js)과, 코드로 남은 도표 원문의 복사 도구(document.js).
  assert.deepEqual(output.runtime.toSorted(), ['diagram.js', 'document.js']);
});

// 검토 보완: props 분리, 열기 실패 뒤 닫기 억제, 모든 throw 값 정규화, 성공한 자산 주소만 기록.
const broken = (calls) => ({
  open: () => {
    calls.push('open');
    throw new Error('open failed');
  },
  close: () => {
    calls.push('close');
    return '</broken>';
  },
});

test('component_props_are_deep_copies_so_replacements_cannot_change_the_document_or_later_output', async () => {
  const source = [
    '::figure{src=2-today-mac.png alt=원본}',
    ':::gallery{title=갤러리}\n::slide{src=2-today-mac.png alt=슬라이드}\n:::',
    ':::tabs\n@tab 가\n\n본문\n\n:::end',
    '```ui:figure\nsrc: 2-today-mac.png\nalt: 데이터\n```',
  ].join('\n\n');
  const document = await parse(source);
  const before = snapshotTokens(document.tokens);
  const baseline = (await render(document)).html;
  const mutate = (props) => {
    for (const key of Object.keys(props)) {
      if (typeof props[key] === 'string') props[key] = 'MUTATED';
      if (Array.isArray(props[key])) props[key].push('MUTATED');
    }
    if (props.slides) props.slides[0].alt = 'MUTATED';
  };
  const theme = {
    components: {
      figure: (props) => {
        mutate(props);
        return '<figure>x</figure>';
      },
      gallery: (props) => {
        mutate(props);
        return '<div>g</div>';
      },
      tabs: {
        open: (props) => {
          mutate(props);
          return '<section>';
        },
        close: (props) => {
          assert.deepEqual(props.labels, ['가'], 'close must receive its own copy');
          return '</section>';
        },
      },
    },
  };
  const custom = await render(document, { theme });
  assert.deepEqual(custom.diagnostics, []);
  assert.deepEqual(snapshotTokens(document.tokens), before);
  assert.equal((await render(document)).html, baseline);
  assert.match(baseline, /alt="원본"/);
});

test('a_failed_open_never_emits_its_close_for_ui_components_and_markdown_pairs', async () => {
  const cases = [
    ['callout', '```ui:callout\ntitle: x\nbody: 안\n```\n', 'callout'],
    ['details', '```ui:details\ntitle: x\nbody: 안\n```\n', 'details'],
    ['tabs', '```ui:tabs\nitems:\n  - { label: A, body: 안 }\n```\n', 'tabs'],
    ['cards', '```ui:cards\nitems:\n  - { title: a, href: /a/, icon: false }\n```\n', 'cards'],
    ['details', '<details>\n<summary>요약</summary>\n\n안\n</details>\n', 'details'],
    ['table', '| a |\n|---|\n| b |\n', 'table'],
  ];
  for (const [name, source, component] of cases) {
    const calls = [];
    const theme = { components: { [component]: broken(calls) } };
    if (component === 'details') theme.components.details.summaryOpen = () => '<summary>';
    if (component === 'details') theme.components.details.summaryClose = () => '</summary>';
    if (component === 'cards') theme.components.cards.gap = () => '';
    const { html, diagnostics } = await render(await parse(source), { theme });
    assert.deepEqual(calls, ['open'], `${name}: close must not be called`);
    assert.doesNotMatch(html, /<\/broken>|<summary>/, name);
    assert.equal(
      diagnostics.filter((item) => item.component === `${component}.open`).length,
      1,
      name,
    );
  }
});

test('a_failed_summary_open_skips_its_close_but_keeps_the_outer_details_close', async () => {
  for (const source of [
    '```ui:details\ntitle: 제목\nbody: 본문\n```',
    '<details>\n<summary>제목</summary>\n\n본문\n</details>',
  ]) {
    const calls = [];
    const theme = {
      components: {
        details: {
          open: () => '<details>',
          summaryOpen: () => {
            throw new Error('summary failed');
          },
          summaryClose: () => {
            calls.push('summaryClose');
            return '</broken>';
          },
          close: () => {
            calls.push('close');
            return '</details>';
          },
        },
      },
    };
    const { html, diagnostics } = await render(await parse(source), { theme });
    assert.deepEqual(calls, ['close']);
    assert.doesNotMatch(html, /<\/broken>/);
    assert.match(html, /본문/);
    assert.match(html, /<\/details>$/);
    assert.equal(diagnostics.filter((item) => item.component === 'details.summaryOpen').length, 1);
  }
});

test('an_inner_failure_does_not_erase_the_outer_pair_state_in_any_nesting', async () => {
  const open = (tag) => () => `<${tag}>`;
  const close = (tag) => () => `</${tag}>`;
  const failing = {
    open: () => {
      throw new Error('inner');
    },
    close: () => '</inner-broken>',
  };
  const theme = {
    components: {
      tabs: { open: open('outer-tabs'), close: close('outer-tabs') },
      details: {
        open: open('outer-details'),
        close: close('outer-details'),
        summaryOpen: open('s'),
        summaryClose: close('s'),
      },
      callout: failing,
      table: failing,
    },
  };
  const source = [
    '```ui:tabs\nitems:\n  - label: A\n    body: "```ui:callout\\ntitle: x\\nbody: 안\\n```"\n```',
    '<details>\n<summary>요약</summary>\n\n| a |\n|---|\n| b |\n\n</details>',
    ':::tabs\n@tab A\n\n:::note\n안\n:::\n\n:::end',
  ].join('\n\n');
  const { html, diagnostics } = await render(await parse(source), { theme });
  // 탭 묶음은 ui:tabs와 :::tabs 두 개다.
  assert.equal((html.match(/<outer-tabs>/g) ?? []).length, 2);
  assert.equal((html.match(/<\/outer-tabs>/g) ?? []).length, 2);
  assert.equal((html.match(/<outer-details>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/outer-details>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /inner-broken/);
  assert.deepEqual(
    diagnostics.map((item) => item.component),
    ['callout.open', 'table.open', 'callout.open'],
  );
});

test('every_thrown_value_becomes_a_diagnostic_message_and_the_render_continues', async () => {
  const hostile = Object.create(null);
  const cases = [
    [null, 'null'],
    [undefined, 'undefined'],
    ['문자열 오류', '문자열 오류'],
    [42, '42'],
    [{ toString: () => '객체 오류' }, '객체 오류'],
    [hostile, 'unknown error'],
    [new Error('보통 오류'), '보통 오류'],
  ];
  for (const [thrown, message] of cases) {
    const theme = {
      components: {
        kbd: () => {
          throw thrown;
        },
      },
    };
    const output = await render(await parse(':kbd[x]\n\n뒤\n'), { theme });
    assert.deepEqual(
      output.diagnostics.map((item) => [item.stage, item.component, item.message]),
      [['render', 'kbd', message]],
      String(message),
    );
    assert.match(output.html, /<p>뒤<\/p>/);
  }
});

test('only_assets_whose_url_lookup_succeeded_are_recorded_and_the_url_is_reused', async () => {
  const calls = [];
  const resolver = {
    exists: () => true,
    url(name) {
      calls.push(name);
      if (name === '3-upcoming-mac-2.png') throw new Error('lookup failed');
      if (name === '4-headings-mac.png') return 7;
      return `/app-assets/${name}`;
    },
  };
  const source = [
    '```ui:figure\nsrc: 2-today-mac.png\nalt: 성공\n```',
    '```ui:figure\nsrc: 3-upcoming-mac-2.png\nalt: 실패\n```',
    '```ui:figure\nsrc: 4-headings-mac.png\nalt: 문자열 아님\n```',
    '뒤 문단',
  ].join('\n\n');
  const output = await render(await parse(source, { assets: resolver }), { assets: resolver });
  assert.deepEqual(output.assets, [
    { name: '2-today-mac.png', url: '/app-assets/2-today-mac.png' },
  ]);
  assert.deepEqual(
    output.diagnostics.map((item) => item.message),
    ['lookup failed', 'asset url must be a string: 4-headings-mac.png'],
  );
  assert.deepEqual(
    calls,
    ['2-today-mac.png', '3-upcoming-mac-2.png', '4-headings-mac.png'],
    'the final result reuses recorded urls',
  );
  assert.match(output.html, /<p>뒤 문단<\/p>/);
});

test('image_attributes_escape_asset_urls_and_reject_unsafe_urls_and_sizes', async () => {
  const run = async (assets) => {
    const resolver = { exists: () => true, ...assets };
    return render(await parse('::figure{src=2-today-mac.png alt=a}\n', { assets: resolver }), {
      assets: resolver,
    });
  };
  const quote = await run({ url: (name) => `/a"onerror="x&y=1/${name}` });
  assert.match(quote.html, /src="\/a&quot;onerror=&quot;x&amp;y=1\/2-today-mac\.png"/);
  assert.doesNotMatch(quote.html, /onerror="/);
  assert.deepEqual(quote.assets, [
    { name: '2-today-mac.png', url: '/a"onerror="x&y=1/2-today-mac.png' },
  ]);
  const valid = await run({ url: (name) => `https://assets.example/${name}?v=1&w=2` });
  assert.match(valid.html, /src="https:\/\/assets\.example\/2-today-mac\.png\?v=1&amp;w=2"/);
  assert.doesNotMatch(valid.html, /&amp;amp;/);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,x',
    'app://x/a.png',
    '//evil.example/a.png',
    '/a b.png',
  ]) {
    const bad = await run({ url: () => url });
    assert.deepEqual(bad.assets, [], url);
    assert.match(bad.diagnostics.map((item) => item.message).join(), /Unsupported URL/, url);
    assert.doesNotMatch(bad.html, /<img[^>]*src=/, url);
  }
  for (const size of [
    ['1" onerror="x', 2],
    [1],
    [0, 5],
    [1.5, 2],
    'big',
    new Array(2),
    Object.assign(new Array(2), { 1: 2 }),
    Object.assign(new Array(2), { 0: 3 }),
  ]) {
    const bad = await run({ url: (name) => `/a/${name}`, size: () => size });
    assert.match(
      bad.diagnostics.map((item) => item.message).join(),
      /Invalid image size/,
      String(size),
    );
    assert.doesNotMatch(bad.html, /onerror=/);
  }
});

const tabsOf = (diagram, options = '') =>
  `:::tabs${options}\n@tab 도표\n\n\`\`\`diagramplay\n${diagram}\`\`\`\n\n@tab 글\n\n본문\n:::end\n`;

test('tabs_holding_a_multi_scene_diagram_fill_only_omitted_position_and_selector', async () => {
  const many = 'diagramplay\nmany\n';
  const one = 'diagramplay\none\n';
  const embed = (scenes) => ({
    src: '/diagrams/x.html',
    title: 't',
    dimensions: { width: 10, height: 10 },
    scenes,
  });
  const known = new Map([
    [many, embed(2)],
    [one, embed(1)],
  ]);
  const unscened = new Map([
    [many, embed(undefined)],
    [one, embed(undefined)],
  ]);
  const html = async (diagram, options = '', diagrams = known) =>
    (await render(await parse(tabsOf(diagram, options)), { diagrams })).html;
  assert.equal(await html(many), await html(many, ' position=top selector=segmented'));
  assert.notEqual(await html(many), await html(one));
  assert.equal(await html(one), await html(one, '', unscened));
  assert.notEqual(await html(many, '', unscened), await html(many));
  assert.equal(
    await html(many, ' selector=numbers'),
    await html(many, ' position=top selector=numbers'),
  );
  assert.equal(
    await html(many, ' frame=panel'),
    await html(many, ' frame=panel position=top selector=segmented'),
  );
  assert.equal(
    await html(many, ' position=bottom'),
    await html(many, ' position=bottom selector=segmented'),
  );
  assert.notEqual(await html(many, ' frame=panel'), await html(many));
});

test('platform_tabs_and_later_tab_sets_ignore_the_scene_decision', async () => {
  const many = 'diagramplay\nmany\n';
  const plainDiagram = 'diagramplay\none\n';
  const embed = (scenes) => ({
    src: '/diagrams/x.html',
    title: 't',
    dimensions: { width: 10, height: 10 },
    scenes,
  });
  const diagrams = new Map([
    [many, embed(2)],
    [plainDiagram, embed(1)],
  ]);
  const without = new Map([
    [many, embed(undefined)],
    [plainDiagram, embed(undefined)],
  ]);
  const fence = `\`\`\`diagramplay\n${many}\`\`\`\n`;
  const platformNew = `:::platform\n@tab Mac\n\n${fence}\n@tab Win\n\n본문\n:::end\n`;
  for (const input of [
    platformNew,
    `:::platform position=top\n@tab Mac\n\n${fence}\n@tab Win\n\n본문\n:::end\n`,
  ]) {
    const document = await parse(input);
    const withScenes = await render(document, { diagrams });
    assert.match(withScenes.html, /^<section class="app-tabs is-platform"/);
    assert.equal(withScenes.html, (await render(document, { diagrams: without })).html);
  }
  const normal = (value) => value.replace(/component-[\w-]+?-\d+/g, 'X');
  const alone = normal((await render(await parse(tabsOf(plainDiagram)), { diagrams })).html);
  const both = (await render(await parse(tabsOf(many) + tabsOf(plainDiagram)), { diagrams })).html;
  const sections = both.split('<section').slice(1);
  assert.equal(sections.length, 2);
  assert.equal(normal(`<section${sections[1]}`), alone);
});

test('diagramplay_name_never_reaches_the_rendered_html_or_the_diagram_path', async () => {
  const flow = 'diagramplay\nsame\n';
  const embed = { src: '/diagrams/abc.html', title: 't', dimensions: { width: 10, height: 10 } };
  const diagrams = new Map([[flow, embed]]);
  const html = async (info) =>
    (await render(await parse(`\`\`\`${info}\n${flow}\`\`\`\n`), { diagrams })).html;
  const plain = await html('diagramplay');
  assert.match(plain, /<iframe data-diagram src="\/diagrams\/abc\.html"/);
  assert.equal(await html('diagramplay name=secret-name'), plain);
  assert.doesNotMatch(await html('diagramplay width=wide name=secret-name'), /secret-name/);
  assert.match(await html('diagramplay width=wide name=secret-name'), /app-width-wide/);
});

test('footnote_ids_carry_the_page_id_so_documents_in_one_feed_do_not_collide', async () => {
  const note = (label) => `본문[^1]\n\n[^1]: ${label}\n`;
  const [first, second] = await Promise.all(
    ['a', 'b'].map(async (pageId) => render(await parse(note(pageId), { id: pageId, pageId }), {})),
  );
  assert.match(first.html, /id="fn-a-1"/);
  assert.match(first.html, /href="#fn-a-1"/);
  assert.match(first.html, /id="fnref-a-1"/);
  assert.match(second.html, /id="fn-b-1"/);
  const ids = (html) => new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual(
    [...ids(first.html)].filter((id) => ids(second.html).has(id)),
    [],
  );
  // pageId가 없으면 이전과 같이 접두사가 없다.
  const plain = await render(await parse(note('x'), { pageId: undefined }), {});
  assert.match(plain.html, /id="fn1"/);
  // 구성 요소 안 각주는 구성 요소 번호를 따른다(페이지 접두사가 아니다).
  const nested = await render(
    await parse('```ui:callout\ntitle: t\nbody: "안쪽[^1]\\n\\n[^1]: 안쪽 각주"\n```\n', {
      id: 'a',
      pageId: 'a',
    }),
    {},
  );
  assert.match(nested.html, /id="fn-component-a-1-1-1"/);
});
