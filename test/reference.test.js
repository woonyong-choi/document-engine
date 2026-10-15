// 고정 commit의 홈페이지 createMarkdown과 같은 입력·같은 조건에서 새 엔진의 HTML·제목·진단을 비교한다.
// 비교 항목: 문서 HTML 전체(바이트 동일), 제목 목록(id·title·level), 오류의 메시지·줄·구성 이름.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { documentEngine } from '../index.js';

import { DOCUMENTS, ERROR_CASES, UI_ERROR_CASES, UI_SYNTAX_ERRORS } from './fixtures/documents.js';
import { loadReference, referenceSource } from './support/reference.js';
import { ASSET_NAMES, IMAGE_SIZES, assets } from './support/synthetic.js';

const skip = referenceSource
  ? false
  : 'HOMEPAGE_SOURCE is not set: the pinned homepage output was not compared';
const reference = skip
  ? undefined
  : await loadReference({ assetNames: ASSET_NAMES, imageSizes: IMAGE_SIZES });

after(() => reference?.dispose());

async function renderNew(source, extra = {}) {
  const document = await documentEngine.parseDocument(source, {
    id: 'doc.md',
    pageId: 'p',
    assets,
  });
  return { document, output: await documentEngine.renderDocument(document, { assets, ...extra }) };
}

function renderOriginal(source, env = {}) {
  // 원본은 각주 ID 접두사(docId)를 호출자가 env로 준다. 새 엔진은 같은 값을 pageId에서 정하므로 같은 입력 조건으로 맞춘다.
  const fullEnv = { pageId: 'p', docId: 'p', ...env };
  const html = reference.createMarkdown().render(source, fullEnv);
  return { html, env: fullEnv };
}

// 아이콘 SVG의 그림은 디자인 정본이 소유한다. 고정 홈페이지가 담은 디자인과 호스트가 설치한 디자인의 commit이 다르면
// 그림이 다르므로 <svg> 여는 태그만 비교하고 내용은 지운다. 디자인 정본의 SVG 함수는 아이콘 ID에 프로세스 전체
// 카운터(icon-N-)를 쓴다. 번호는 호출 이력에 따라 달라지므로 처음 나온 순서대로 다시 매겨 같은 구조인지만 비교한다.
// 아이콘 유효성 검사가 SVG 출력에서 카탈로그 확인으로 바뀌어 카운터가 쓰이는 횟수가 원본과 다르다.
function canonical(html) {
  const numbers = new Map();
  return html
    .replace(/(<svg[^>]*>)[\s\S]*?<\/svg>/g, '$1</svg>')
    .replace(/icon-(\d+)-/g, (_, number) => {
      if (!numbers.has(number)) numbers.set(number, numbers.size + 1);
      return `icon-${numbers.get(number)}-`;
    });
}

const withoutLines = (headings) => headings.map(({ id, title, level }) => ({ id, title, level }));

for (const [name, source] of Object.entries(DOCUMENTS)) {
  test(`reference_html_and_headings_match_for_${name}`, { skip }, async () => {
    const original = renderOriginal(source);
    const { output } = await renderNew(source);
    assert.equal(canonical(output.html), canonical(original.html));
    assert.deepEqual(withoutLines(output.headings), original.env.headings ?? []);
    assert.deepEqual(output.diagnostics, []);
  });
}

test('reference_html_matches_for_the_pinned_syntax_specimen', { skip }, async () => {
  const source = reference.readSource('src/fixtures/syntax-specimen.md');
  const original = renderOriginal(source);
  const { output } = await renderNew(source);
  assert.equal(canonical(output.html), canonical(original.html));
  assert.deepEqual(withoutLines(output.headings), original.env.headings);
  assert.deepEqual(output.diagnostics, []);
});

for (const [name, source] of ERROR_CASES) {
  test(`reference_error_matches_for_${name}`, { skip }, async () => {
    let thrown;
    try {
      renderOriginal(`${source}`);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, `the original must fail: ${name}`);
    const { document, output } = await renderNew(source);
    const [first] = document.diagnostics;
    assert.equal(first.message, thrown.detail, name);
    assert.equal(first.line, thrown.line, name);
    assert.equal(first.directive, thrown.directive, name);
    assert.ok(output.html.length > 0);
  });
}

for (const [name, source] of UI_ERROR_CASES) {
  test(`reference_ui_error_matches_for_${name}`, { skip }, async () => {
    let thrown;
    try {
      renderOriginal(source);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, `the original must fail: ${name}`);
    const { document, output } = await renderNew(source);
    const [first] = [
      ...document.diagnostics,
      ...output.diagnostics.filter((item) => item.stage === 'render'),
    ];
    assert.equal(first.message, thrown.message, name);
  });
}

for (const [name, source] of UI_SYNTAX_ERRORS) {
  test(`reference_and_engine_both_reject_${name}`, { skip }, async () => {
    assert.throws(() => renderOriginal(source));
    const { document } = await renderNew(source);
    assert.equal(document.diagnostics.length, 1);
    assert.equal(document.diagnostics[0].severity, 'error');
  });
}

test('reference_thinkflow_embed_and_collected_sources_match', { skip }, async () => {
  const { compileDiagram } = await import('../index.js');
  const flow =
    'thinkflow\ntitle "Mini"\nbox a "A"\nbox b "B"\na -> b "go"\n\nscene "S"\n  a -> b "x"\n';
  const source = `\`\`\`thinkflow width=wide\n${flow}\`\`\`\n\n\`\`\`thinkflow\nmissing\n\`\`\`\n`;
  const diagram = await compileDiagram(flow);
  delete diagram.html;
  const original = renderOriginal(source, {
    diagrams: new Map([[flow, diagram]]),
    diagramSources: new Map(),
  });
  const { document, output } = await renderNew(source, { diagrams: new Map([[flow, diagram]]) });
  assert.equal(canonical(output.html), canonical(original.html));
  assert.deepEqual(
    document.metadata.diagrams.map((item) => item.source),
    [...original.env.diagramSources.keys()],
  );
  assert.deepEqual(
    output.diagrams.map((item) => item.status),
    ['embedded', 'pending'],
  );
});

// 의도한 개선: 원본은 <summary> 안의 인라인 오류에 줄을 붙이지 못한다(line 없음). 엔진은 요약 줄을 가리킨다.
// 오류 원인(메시지·구성 이름)은 원본과 같아야 하고, 줄만 달라진다.
test('reference_details_summary_error_differs_only_by_the_added_line', { skip }, async () => {
  const source = '문단\n\n<details>\n<summary>:tip[설명]</summary>\n본문\n</details>\n';
  let thrown;
  try {
    renderOriginal(source);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'the original must fail');
  assert.equal(thrown.line, undefined);
  const { document } = await renderNew(source);
  const [first] = document.diagnostics;
  assert.equal(first.message, thrown.detail);
  assert.equal(first.directive, thrown.directive);
  assert.equal(first.line, 4);
});
