// 브라우저 미리보기 진입점. 해석기와 동기 출력만 내보내며 Node 모듈을 불러오지 않는다.
export { parseDocumentSync } from '../parser/index.js';
export { renderPreview } from '../renderer/render-preview.js';
