// 펜스 언어 별칭. 코드 강조 엔진을 불러오지 않는 순수 함수라 브라우저 미리보기에서도 쓴다.

/**
 * 호스트가 출력 문맥의 codeAliases로 준 별칭을 적용한 펜스 언어 정보. 별칭은 `{ 이름: { language, label? } }`이며
 * 이름은 펜스 정보의 첫 낱말(소문자)과 비교한다. 별칭이 없으면 원래 정보와 undefined 라벨을 돌려준다.
 * @param {string} info 펜스 정보 문자열
 * @param {Record<string, { language: string, label?: string }> | undefined} aliases
 * @returns {{ info: string, label?: string }}
 */
export function resolveCodeAlias(info, aliases) {
  const word = info.trim().split(/\s+/)[0].toLowerCase();
  const alias = aliases && Object.hasOwn(aliases, word) ? aliases[word] : undefined;
  if (typeof alias?.language !== 'string') return { info };
  return { info: alias.language, label: typeof alias.label === 'string' ? alias.label : undefined };
}
