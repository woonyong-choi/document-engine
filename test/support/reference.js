// 고정 commit의 홈페이지 원본(createMarkdown)을 같은 입력으로 실행한다.
// 원본 작업본은 읽기만 한다: 사본을 만들지 않고 그 자리의 src/markdown.mjs를 직접 불러온다. 실행 때 HEAD가
// 고정 commit이고 추적 파일이 깨끗한지 확인한다. 원본 모듈이 읽는 설정(config/image-sizes.json)과 자산 존재
// 확인(content/assets/<이름>)만 시험 경계에서 합성 값으로 바꾸고, 그 밖의 파일 읽기는 그대로 둔다.
// 개인 원고 폴더는 읽지 않는다. 파일 함수 교체는 node:test mock과 module.syncBuiltinESMExports를 쓴다(Node 22.12 이상).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REFERENCE_COMMIT = '87af00676f181524d8386c2af39a06554f227325';

/** 원본 작업본 경로. 지정하지 않으면 원본 비교 시험은 건너뛴다. */
export const referenceSource = process.env.HOMEPAGE_SOURCE;

const git = (...args) =>
  execFileSync('git', ['-C', referenceSource, ...args], { encoding: 'utf8' });
const asPath = (value) => resolve(value instanceof URL ? fileURLToPath(value) : String(value));

/**
 * @param {{ assetNames: string[], imageSizes: Record<string, [number, number]> }} synthetic 합성 자산 목록과 크기
 * @returns {Promise<{ createMarkdown: Function, readSource: (path: string) => string, dispose: () => void }>}
 */
export async function loadReference({ assetNames, imageSizes }) {
  const head = git('rev-parse', 'HEAD').trim();
  if (head !== REFERENCE_COMMIT) {
    throw new Error(`the homepage reference must be at ${REFERENCE_COMMIT}, found ${head}`);
  }
  const dirty = git('status', '--porcelain', '--untracked-files=no').trim();
  if (dirty) throw new Error(`the homepage reference has tracked changes:\n${dirty}`);

  const root = resolve(referenceSource);
  const sizesFile = join(root, 'config', 'image-sizes.json');
  const assetsDir = join(root, 'content', 'assets');
  const { readFileSync, existsSync } = fs;
  const handles = [
    mock.method(fs, 'readFileSync', (path, ...rest) =>
      asPath(path) === sizesFile
        ? Buffer.from(JSON.stringify(imageSizes))
        : readFileSync(path, ...rest),
    ),
    mock.method(fs, 'existsSync', (path) => {
      const file = asPath(path);
      return dirname(file) === assetsDir ? assetNames.includes(basename(file)) : existsSync(path);
    }),
  ];
  // t.mock과 달리 전역 mock은 자동으로 복원되지 않는다. 원본이 렌더 때 content/assets를 조회하므로 시험이 끝날 때까지 유지하고
  // 불러오기에 실패하면 바로, 아니면 반환한 dispose로 복원한다.
  const dispose = () => {
    for (const handle of handles) handle.mock.restore();
    syncBuiltinESMExports();
  };
  syncBuiltinESMExports();
  let module;
  try {
    module = await import(pathToFileURL(join(root, 'src', 'markdown.mjs')).href);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    createMarkdown: module.createMarkdown,
    dispose,
    readSource: (path) => git('show', `${REFERENCE_COMMIT}:${path}`),
  };
}
