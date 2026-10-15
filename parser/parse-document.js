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
export function parseDocument(source, context = {}) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
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
