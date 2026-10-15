// 홈페이지와 다른 소비자가 같은 고정 버전으로 쓰는 문서 엔진. 해석과 출력은 독립 진입점이다.
import { parseDocument as parse } from './parser/parse-document.js';
import { renderDocument as render } from './renderer/render-document.js';
import { loadDefaultTheme } from './theme/default-theme.js';

export { DirectiveError } from './parser/diagnostics.js';
export { compileDiagram, compileDiagrams } from './renderer/diagram.js';
export { MATH_STYLESHEET, mathAssets, usesMath } from './renderer/math-assets.js';
export { ThemeError } from './theme/resolve-theme.js';
export { DEFAULT_THEME_FILES } from './theme/default-theme.js';

/**
 * 기본 테마의 아이콘 카탈로그와 주소 정책으로 문법 확인 함수를 채워 해석한다.
 * 호출자가 같은 이름의 함수를 주면 그 값을 쓴다. 자산 확인은 호스트만 알 수 있으므로 기본값이 없다.
 * @param {string} source
 * @param {import('./parser/parse-document.js').ParseContext} context
 */
export async function parseDocument(source, context = {}) {
  const theme = await loadDefaultTheme();
  const catalog = theme.icons.getIconCatalog();
  return parse(source, {
    icons: { has: (name) => hasIcon(catalog, name) },
    urls: { isSafe: (url) => isSafeUrl(theme.ui, url) },
    ...context,
  });
}

export const renderDocument = render;

/** 호출자가 받는 엔진. `parseDocument(source, { id })`, `renderDocument(document, { id })`로 호출한다. */
export const documentEngine = Object.freeze({ parseDocument, renderDocument });

function hasIcon(catalog, name) {
  const target = Object.hasOwn(catalog.icons, name) ? name : catalog.aliases[name];
  return typeof target === 'string' && Object.hasOwn(catalog.icons, target);
}

function isSafeUrl(ui, url) {
  try {
    ui.safeUrl(url);
    return true;
  } catch {
    return false;
  }
}
