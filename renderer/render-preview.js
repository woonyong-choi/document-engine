// 브라우저 작성 화면의 미리보기. 사이트 출력과 같은 Markdown 규칙과 기본 테마 구성 요소로 그린다.
// 코드 강조·도표 컴파일·수학 자산처럼 서버에서만 하는 일은 하지 않는다. 코드는 강조 없이 같은 코드 블록에 넣고,
// 도표는 원문 코드로 보인다. 파일 시스템과 Node 모듈을 쓰지 않으므로 브라우저 번들에 넣을 수 있다.
import { createDefaultComponents } from '../theme/components.js';
import { resolveComponents } from '../theme/resolve-theme.js';

import { renderTokens } from './render-state.js';

const LANGUAGE_NAME = /^[\w+#.-]+$/;
const PLAIN = Object.freeze({ id: 'plaintext', label: 'Plain text' });

// 강조 없는 코드 블록. 언어 이름은 펜스 정보의 첫 낱말을 그대로 표시한다.
const plainHighlighter = Object.freeze({
  codeLanguage(info = '') {
    const word = info.trim().split(/\s+/)[0].toLowerCase();
    return word && LANGUAGE_NAME.test(word) ? { id: word, label: word } : PLAIN;
  },
  async prepare() {},
  highlightCode: (source, language, ui) => ui.escape(source),
});

/**
 * 해석한 문서를 사이트와 같은 규칙으로 동기 출력한다. 테마 모듈은 호스트가 이미 불러온 디자인 패키지를 넘긴다.
 * @param {object} document parseDocumentSync의 결과
 * @param {{ ui: object, icons?: object, svg?: object, assets?: object, codeAliases?: object }} context
 * @returns {{ html: string, diagnostics: object[] }}
 * @throws {TypeError} 해석 결과가 아니거나 ui가 없을 때
 */
export function renderPreview(document, context) {
  if (document?.version !== 1 || !Array.isArray(document.tokens)) {
    throw new TypeError('document must be the result of parseDocument');
  }
  if (!context?.ui) throw new TypeError('renderPreview needs the design ui module');
  const { html, diagnostics } = renderTokens(
    document,
    { ...context, diagrams: undefined },
    {
      theme: { ui: context.ui, icons: context.icons, svg: context.svg },
      components: resolveComponents(createDefaultComponents(), undefined),
      highlighter: plainHighlighter,
      usedAssets: new Map(),
    },
  );
  return { html, diagnostics: [...document.diagnostics, ...diagnostics] };
}
