// 해석 중 발견한 문법 오류와 진단 기록.

export class DirectiveError extends Error {
  /**
   * @param {string} message 위치를 뺀 오류 내용
   * @param {{ page?: string, line?: number, name?: string }} [where] 문서 식별자, 1부터 시작하는 줄, 구성 이름
   */
  constructor(message, { page, line, name } = {}) {
    const where = [page, line ? `본문 ${line}줄` : '', name ? `:${name}` : '']
      .filter(Boolean)
      .join(' ');
    super(where ? `${where}: ${message}` : message);
    this.name = 'DirectiveError';
    Object.assign(this, { page, line, directive: name, detail: message });
  }
}

/**
 * 해석 중 생긴 문법 오류를 문서 진단으로 기록한다. 중첩 본문의 오류는 구성 요소가 있는 줄에 붙이고 안쪽 줄은 nestedLine에 남긴다.
 * @param {{ diagnostics: object[], documentId?: string, fenceLine?: number }} env
 * @param {DirectiveError} error
 */
export function reportSyntaxError(env, error) {
  const nested = env.fenceLine !== undefined;
  const diagnostic = {
    document: env.documentId,
    severity: 'error',
    stage: 'parse',
    message: error.detail,
    line: nested ? env.fenceLine : error.line,
    directive: error.directive,
  };
  if (nested && error.line) diagnostic.nestedLine = error.line;
  env.diagnostics.push(diagnostic);
  return diagnostic;
}
