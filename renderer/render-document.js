// 해석한 문서를 테마로 HTML과 출력 정보로 바꾼다. 파일 저장·탐색 UI와 해석기 내부를 알지 못한다.
import { loadDefaultTheme } from '../theme/default-theme.js';
import { resolveComponents } from '../theme/resolve-theme.js';

import { loadHighlighter } from './code-highlight.js';
import { tabsWithScenes } from './directive-render.js';
import { createKit } from './kit.js';
import { usesMath } from './math-assets.js';
import { createRenderer } from './markdown-rules.js';

let renderer;

/**
 * @typedef {object} RenderContext
 * @property {string} [id] 진단에 붙일 문서 식별자. 생략하면 해석한 문서의 식별자
 * @property {{ components?: object }} [theme] 구성 요소를 교체할 테마. 생략하면 기본 테마
 * @property {{ url?(name: string): string, size?(name: string): [number, number] | undefined }} [assets] 자산 주소와 크기 조회
 * @property {Map<string, object>} [diagrams] 도표 원문에서 만든 삽입 정보. 없는 원문은 코드로 표시한다
 */

/**
 * 해석한 문서를 HTML로 그린다. 문서는 바꾸지 않으므로 같은 문서를 다른 테마로 다시 그릴 수 있다.
 * @param {object} document parseDocument의 결과
 * @param {RenderContext} [context]
 * @returns {Promise<{
 *   html: string, headings: object[], diagnostics: object[],
 *   assets: { name: string, url: string }[], runtime: string[], math: boolean,
 *   diagrams: { source: string, line: number, status: 'embedded' | 'pending' | 'failed' }[],
 *   theme: string,
 * }>}
 * @throws {TypeError} 해석 결과가 아닌 값
 * @throws {ThemeError} 지원하지 않는 구성 요소 교체
 */
export async function renderDocument(document, context = {}) {
  if (document?.version !== 1 || !Array.isArray(document.tokens)) {
    throw new TypeError('document must be the result of parseDocument');
  }
  const theme = await loadDefaultTheme();
  const components = resolveComponents(theme.components, context.theme);
  const highlighter = await loadHighlighter();
  await highlighter.prepare(codeInfos(document.tokens));
  renderer ??= createRenderer();
  const usedAssets = new Map();
  const kit = createKit(theme, context, usedAssets);
  const render = {
    documentId: context.id ?? document.id,
    context,
    kit,
    components,
    highlighter,
    diagnostics: [],
    failedOpens: new WeakSet(),
    sceneTabs: tabsWithScenes(document.tokens, context.diagrams),
    pairs: [],
    renderUnit: (unit) => renderUnit(unit, render),
  };
  const html = renderUnit({ tokens: document.tokens, env: document.env }, render);
  return {
    html,
    headings: document.metadata.headings,
    diagnostics: [...document.diagnostics, ...render.diagnostics],
    assets: [...usedAssets].map(([name, url]) => ({ name, url })),
    runtime: theme.runtimeFor(html),
    math: usesMath(html),
    diagrams: document.metadata.diagrams.map(({ source, line }) => ({
      source,
      line,
      status: diagramStatus(context.diagrams?.get(source)),
    })),
    theme: context.theme?.name ?? theme.name,
  };
}

// 문서와 ui: 구성 요소의 안쪽 필드에 있는 코드 펜스의 언어 정보. 이 언어들의 문법만 불러온다.
function* codeInfos(tokens) {
  for (const token of tokens) {
    if (token.type !== 'fence') continue;
    if (token.meta?.role === 'ui') {
      for (const unit of token.meta.units) yield* codeInfos(unit.tokens);
    } else {
      yield token.info;
    }
  }
}

function diagramStatus(diagram) {
  if (diagram === undefined) return 'pending';
  return diagram.error ? 'failed' : 'embedded';
}

// 해석한 토큰 단위 하나를 그린다. 각주와 중첩 접미사는 단위의 env가 갖고 있다.
function renderUnit(unit, render) {
  const env = {
    footnotes: unit.env.footnotes,
    docId: unit.env.docId,
    fenceLine: unit.env.fenceLine,
    render,
  };
  return renderer.renderer.render(unit.tokens, renderer.options, env);
}
