// 구성 요소 호출 경계. 테마 함수의 실패를 진단으로 바꾸고 오류 표시를 대신 낸다. 기본 출력으로 몰래 대체하지 않는다.

/**
 * @param {object} render 한 번의 렌더링 상태(components, kit, diagnostics)
 * @param {string} name 구성 요소 이름
 * @param {string | undefined} method open·close 같은 하위 함수. 단일 함수면 undefined
 * @param {object} props JSON으로 표현할 수 있는 입력. 호출마다 깊게 복사해 넘기므로 구성 요소가 바꿔도 문서와 다음 출력은 그대로다
 * @param {number} [line] 진단에 붙일 문서 줄
 * @returns {{ html: string, failed: boolean }} 실패하면 html은 오류 표시이고 failed가 true다.
 *   열기·닫기 쌍의 성공 여부는 호출한 쪽이 이 값으로 따로 들고 있는다.
 */
export function attemptComponent(render, name, method, props, line) {
  try {
    const component = render.components[name];
    const result = (method === undefined ? component : component[method])(
      structuredClone(props),
      render.kit,
    );
    if (typeof result !== 'string' && !render.kit.ui.isTrusted(result)) {
      throw new TypeError(
        `component ${name}${method ? `.${method}` : ''} must return an HTML string`,
      );
    }
    return { html: String(result), failed: false };
  } catch (error) {
    return {
      html: reportRenderFailure(render, error, { component: name, method, line }),
      failed: true,
    };
  }
}

/** 실패해도 상태를 따로 볼 필요가 없는 호출. 실패하면 오류 표시를 돌려준다. */
export function callComponent(render, name, method, props, line) {
  return attemptComponent(render, name, method, props, line).html;
}

/** 던져진 값이 무엇이든(Error, 문자열, null, 객체) 오류 문구 하나로 바꾼다. 이 함수는 던지지 않는다. */
export function describeError(value) {
  try {
    if (value instanceof Error) return String(value.message);
    return String(value);
  } catch {
    return 'unknown error';
  }
}

/** 렌더링 중 실패를 진단으로 기록하고 그 자리에 표시할 오류 블록 HTML을 돌려준다. */
export function reportRenderFailure(render, error, { component, method, line }) {
  const message = describeError(error);
  render.diagnostics.push({
    document: render.documentId,
    severity: 'error',
    stage: 'render',
    component: method ? `${component}.${method}` : component,
    message,
    line,
  });
  return errorBlock(render, message);
}

export function errorBlock(render, message) {
  const { ui } = render.kit;
  return String(
    ui.Callout({
      title: '문서 오류',
      tone: 'warning',
      body: ui.trusted(`<p>${ui.escape(message)}</p>`),
    }),
  );
}
