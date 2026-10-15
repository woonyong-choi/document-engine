// 해석 단위의 상태. 문서 본문과 `ui:` 구성 요소 안의 Markdown 필드가 각각 하나의 단위(tokens + env)다.

/**
 * @param {object} context 호출자가 준 해석 문맥
 * @param {object} [parent] 중첩 단위의 부모 env
 * @param {{ fenceLine: number }} [nested] 중첩 단위가 놓인 구성 요소의 줄
 */
export function createEnv(context, parent, nested) {
  return {
    context,
    pageId: context.pageId,
    documentId: context.id,
    // 각주 ID의 접두사다. 문서 본문은 pageId에서 오고(없으면 접두사 없음), 중첩 필드는 구성 요소 번호로 나중에 정해진다.
    docId: nested === undefined ? context.pageId : undefined,
    diagnostics: parent?.diagnostics ?? [],
    diagrams: parent?.diagrams ?? [],
    idSlots: [],
    nested: nested !== undefined,
    fenceLine: nested?.fenceLine,
    // 이 단위가 문서 본문 밖의 inline 전용 필드이면 true. 구성 요소 ID를 부모 번호에 더하지 않는다.
    inlineOnly: false,
  };
}

/**
 * 구성 요소 ID가 필요한 대상을 해석 순서대로 등록한다. 실제 번호는 문서 해석 끝에서 한 번에 붙인다.
 * @param {{ idSlots: object[] }} env
 * @param {object} target id 속성을 받을 meta
 */
export function reserveId(env, target) {
  env.idSlots.push(target);
}
