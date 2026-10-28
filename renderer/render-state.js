// 사이트 출력과 미리보기가 함께 쓰는 출력 상태와 토큰 단위 출력. 테마·강조기 준비는 호출한 진입점이 한다.
import { createKit } from './kit.js';
import { createRenderer } from './markdown-rules.js';

let renderer;

/**
 * 해석한 문서 하나를 그릴 출력 상태를 만들고 문서 전체를 그린다.
 * @param {object} document parseDocument의 결과
 * @param {object} context 출력 문맥
 * @param {{ theme: object, components: object, highlighter: object, usedAssets: Map<string, string> }} parts
 * @returns {{ html: string, diagnostics: object[] }}
 */
export function renderTokens(document, context, { theme, components, highlighter, usedAssets }) {
  renderer ??= createRenderer();
  const render = {
    documentId: context.id ?? document.id,
    context,
    kit: createKit(theme, context, usedAssets),
    components,
    highlighter,
    diagnostics: [],
    failedOpens: new WeakSet(),
    pairs: [],
    renderUnit: (unit) => renderUnit(unit, render),
  };
  const html = renderUnit({ tokens: document.tokens, env: document.env }, render);
  return { html, diagnostics: render.diagnostics };
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
