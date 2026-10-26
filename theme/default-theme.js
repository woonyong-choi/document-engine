// 기본 테마. 디자인 정본의 구성 요소(ui)를 그대로 불러 쓰며 HTML·CSS·SVG를 새로 만들지 않는다.
// 디자인은 호스트 앱이 설치한 @woonyong-choi/design-tokens(peer 의존성) 하나다. 엔진은 사본을 두지 않는다.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { createDefaultComponents } from './components.js';

const THEME_DIR = new URL(
  './dist/',
  pathToFileURL(
    createRequire(import.meta.url).resolve('@woonyong-choi/design-tokens/package.json'),
  ),
);
let loading;

/**
 * 기본 테마 파일의 위치. 호스트가 스타일·글꼴·runtime을 문서 화면에 연결할 때 쓴다.
 * root는 설치된 디자인 패키지의 dist 폴더이고 나머지는 그 안의 상대 위치다.
 */
export const DEFAULT_THEME_FILES = Object.freeze({
  root: THEME_DIR,
  tokens: 'tokens.css',
  styles: 'styles.css',
  runtimeDir: 'ui/runtime/',
  iconCatalog: 'assets/icons/catalog.json',
});

/** @returns {Promise<{ name: string, ui: object, icons: object, svg: object, runtimeFor: Function, components: object }>} */
export function loadDefaultTheme() {
  loading ??= importTheme();
  return loading;
}

async function importTheme() {
  // 구성 요소·아이콘·SVG는 디자인 패키지의 이름 있는 export로 읽는다. runtime 목록(manifest)은 이름 있는 export가
  // 없어 디자인 패키지의 `./*`(dist) 경로로 읽는다.
  const [ui, icons, svg, manifest] = await Promise.all([
    import('@woonyong-choi/design-tokens/components'),
    import('@woonyong-choi/design-tokens/icons'),
    import('@woonyong-choi/design-tokens/svg'),
    import('@woonyong-choi/design-tokens/ui/manifest.mjs'),
  ]);
  return {
    name: 'default',
    ui,
    icons,
    svg,
    runtimeFor: manifest.runtimeEntrypoints,
    components: createDefaultComponents(),
  };
}
