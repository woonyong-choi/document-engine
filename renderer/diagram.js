import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describeError } from './call.js';

let checked;

/**
 * 도표 원문 하나를 독립 HTML 문서와 삽입 정보로 만든다.
 * @param {string} source 도표 원문(첫 의미 줄이 `diagramplay`). 그대로 DiagramPlay에 넘기며 파일 접근은 허용하지 않는다
 * @returns {Promise<{ src: string, title: string, dimensions: { width: number, height: number }, scenes: number, html: Buffer }>}
 *   scenes는 컴파일 결과의 장면 선택 단계 수다(원문이나 HTML을 다시 읽어 세지 않는다)
 *   src는 html을 제공할 사이트 경로다. 같은 원문은 같은 src를 얻는다
 * @throws {Error} 원문 오류, diagramplay가 설치되지 않았을 때, DiagramPlay와 기본 테마가 서로 다른 디자인 패키지를 읽을 때
 */
export async function compileDiagram(source) {
  checked ??= assertSameDesign();
  await checked;
  const { buildFigure, toHtml } = await loadDiagramPlay();
  try {
    const result = await buildFigure(source, { allowFileAccess: false });
    const title = result.figure.title ?? '도표';
    const html = Buffer.from(await toHtml(result, title, { source }));
    const hash = createHash('sha256').update(html).digest('hex');
    return {
      src: `/diagrams/${hash}.html`,
      title,
      dimensions: { width: result.scene.width, height: result.scene.height },
      scenes: result.timeline.steps.length,
      html,
    };
  } catch (error) {
    throw new Error(`DiagramPlay 도표를 만들 수 없습니다. ${describeError(error)}`, {
      cause: error,
    });
  }
}

/**
 * 여러 원문을 만들어 렌더러 문맥에 넘길 형태로 모은다. 실패한 원문은 { error }로 남겨 문서에 오류로 표시한다.
 * @param {Iterable<string>} sources
 * @returns {Promise<{ diagrams: Map<string, object>, assets: Map<string, Buffer> }>}
 */
export async function compileDiagrams(sources) {
  const diagrams = new Map();
  const assets = new Map();
  for (const source of new Set(sources)) {
    try {
      const { html, ...diagram } = await compileDiagram(source);
      diagrams.set(source, diagram);
      assets.set(diagram.src, html);
    } catch (error) {
      diagrams.set(source, { error: describeError(error) });
    }
  }
  return { diagrams, assets };
}

const MISSING_DIAGRAMPLAY =
  '도표를 만들려면 호스트 앱에 diagramplay(^0.2.0)를 설치해야 합니다. 도표 없이 문서만 해석·출력할 때는 필요하지 않습니다.';

// diagramplay는 선택 peer 의존성이다. 설치되지 않았으면 무엇을 설치할지 알려 주는 오류를 던진다.
function resolveDiagramPlay(engine) {
  try {
    return engine.resolve('diagramplay');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') throw new Error(MISSING_DIAGRAMPLAY, { cause: error });
    throw error;
  }
}

function loadDiagramPlay() {
  return import('diagramplay').catch((error) => {
    if (error?.code === 'ERR_MODULE_NOT_FOUND')
      throw new Error(MISSING_DIAGRAMPLAY, { cause: error });
    throw error;
  });
}

async function assertSameDesign() {
  const DESIGN = '@woonyong-choi/design-tokens/package.json';
  const engine = createRequire(import.meta.url);
  const renderer = createRequire(resolveDiagramPlay(engine));
  if (realpathSync(engine.resolve(DESIGN)) !== realpathSync(renderer.resolve(DESIGN))) {
    throw new Error('DiagramPlay와 문서 엔진이 서로 다른 공통 디자인 패키지를 읽습니다.');
  }
}
