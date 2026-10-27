// 원문을 문서 구조로 해석한다. 테마·DOM·파일 시스템을 알지 못하고 HTML을 만들지 않는다.
import { finalizeDocument } from './finalize.js';
import { createParser } from './markdown.js';
import { createEnv } from './units.js';

let parser;

/**
 * @typedef {object} ParseContext
 * @property {string} id 문서 식별자. 진단에 붙는다
 * @property {string} [pageId] 구성 요소·제목 ID의 접두사. 영문·숫자·`_`·`-`만 쓴다
 * @property {{ exists(name: string): boolean }} [assets] 자산 이름이 있는지 확인한다
 * @property {{ has(name: string): boolean }} [icons] 아이콘 이름이 카탈로그에 있는지 확인한다
 * @property {{ isSafe(url: string): boolean }} [urls] 문서에 쓸 수 있는 주소인지 확인한다
 * @property {{ tabs?: boolean, diagrams?: boolean }} [features] 선택 문법 사용 여부. 생략한 항목은 켜짐이다
 * @property {{ widths?: string[], cardVariants?: string[] }} [vocabulary] 디자인이 정한 값 목록. 없는 목록은 해석 단계에서 확인하지 않는다
 */

/**
 * 원문을 해석한다. 문법 오류는 던지지 않고 위치가 있는 진단으로 돌려준다.
 * @param {string} source 문서 원문. 변경하지 않는다
 * @param {ParseContext} context
 * @returns {{
 *   version: 1, id: string, pageId?: string,
 *   tokens: object[], env: object,
 *   metadata: { headings: object[], diagrams: object[], links: object[] },
 *   diagnostics: object[],
 * }}
 * @throws {TypeError} 원문이나 문맥 형식이 틀렸을 때
 */
export function parseDocumentSync(source, context = {}) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  if (typeof context.id !== 'string' || context.id === '') {
    throw new TypeError('context.id must be a non-empty string');
  }
  if (context.features !== undefined) checkFeatures(context.features);
  if (context.pageId !== undefined && !/^[\w-]+$/.test(context.pageId)) {
    throw new TypeError(`pageId must match [\\w-]+: ${context.pageId}`);
  }
  parser ??= createParser();
  const env = createEnv(context);
  const tokens = parser.parse(source, env);
  const { headings, links } = finalizeDocument({ tokens, env });
  return {
    version: 1,
    id: context.id,
    pageId: context.pageId,
    tokens,
    env,
    metadata: { headings, diagrams: env.diagrams, links },
    diagnostics: env.diagnostics,
  };
}

const FEATURES = ['tabs', 'diagrams'];

// 선택 문법 스위치는 이름이 정해진 불리언만 받는다. 오타가 조용히 무시되지 않게 한다.
function checkFeatures(features) {
  if (features === null || typeof features !== 'object' || Array.isArray(features)) {
    throw new TypeError('features must be an object');
  }
  for (const [name, value] of Object.entries(features)) {
    if (!FEATURES.includes(name)) throw new TypeError(`unknown feature: ${name}`);
    if (typeof value !== 'boolean') throw new TypeError(`feature ${name} must be a boolean`);
  }
}
