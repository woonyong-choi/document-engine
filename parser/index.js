// 독립 해석기 진입점(`document-engine/parser`). 테마·HTML 없이 동기로 해석한다. 검증 함수와 값 목록은 호출자가 준다.
export { parseDocumentSync } from './parse-document.js';
