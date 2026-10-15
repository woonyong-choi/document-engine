// 해석을 끝낸 단위들에 문서 전체에서 유일한 값을 붙인다: 구성 요소 ID, 제목 ID, 중첩 각주 접미사.
// 번호 순서는 기존 홈페이지 출력과 같다. 단위마다 해석 중 등록한 ID를 먼저 받고, 제목 ID를 받은 뒤,
// 출력 순서대로 영상과 ui: 구성 요소가 번호를 받으며 그 안의 Markdown 필드 단위로 같은 일을 반복한다.

/**
 * @param {{ tokens: object[], env: object }} root 문서 본문 단위
 * @returns {{
 *   headings: { id: string, title: string, level: number, line: number }[],
 *   links: { kind: 'link' | 'image', target: string, line: number }[],
 * }} 문서 제목 목록과, 해석이 만난 링크·이미지 대상(원문 그대로, 중첩 필드 포함)
 */
export function finalizeDocument(root) {
  const shared = { counter: 0, headingIds: new Map(), headings: [], links: [] };
  finalizeUnit(root, shared);
  return { headings: shared.headings, links: shared.links };
}

function finalizeUnit(unit, shared) {
  const { env, tokens } = unit;
  for (const target of env.idSlots) assignId(target, nextId(shared, env));
  assignHeadingIds(unit, shared);
  collectLinks(unit, shared);
  for (const token of tokens) {
    if (token.type === 'directive' && token.meta.name === 'video') {
      token.meta.id = nextId(shared, env);
    } else if (token.type === 'fence' && token.meta?.role === 'ui') {
      finalizeComponent(token, shared, env);
    }
  }
}

function finalizeComponent(token, shared, env) {
  const { meta } = token;
  meta.id = nextId(shared, env);
  meta.units.forEach((field, index) => {
    field.env.docId = `${meta.id}-${index + 1}`;
    // 한 줄 필드는 부모의 번호를 이어받아 쓰되 되돌려 주지 않는다.
    finalizeUnit(field, field.inline ? { ...shared } : shared);
  });
}

function nextId(shared, env) {
  shared.counter += 1;
  return `component-${env.pageId ?? 'page'}-${shared.counter}`;
}

function assignId(target, id) {
  target.id = id;
  for (const panel of target.panels ?? []) panel.group = id;
}

function toHeadingText(tokens) {
  return tokens
    .map((token) => {
      if (token.children) return toHeadingText(token.children);
      if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
      return token.meta?.plainText ?? token.content;
    })
    .join('');
}

function assignHeadingIds(unit, shared) {
  const { tokens, env } = unit;
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return;
    const inline = tokens[index + 1];
    const title = toHeadingText(inline.children) || inline.content;
    // 기존 문서의 앵커 주소는 목차 표시 문구와 독립적으로 유지한다.
    const slug =
      inline.content
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '') || 'section';
    // 다른 제목의 `제목-2` 같은 글자와 겹치지 않도록 예약된 ID는 건너뛴다.
    let count = shared.headingIds.get(slug) ?? 0;
    let localId;
    do localId = ++count === 1 ? slug : `${slug}-${count}`;
    while (shared.headingIds.has(`#${localId}`));
    shared.headingIds.set(slug, count);
    shared.headingIds.set(`#${localId}`, 1);
    const id = env.pageId ? `${env.pageId}-${localId}` : localId;
    token.attrSet('id', id);
    const level = Number(token.tag.slice(1));
    shared.headings.push({ id, title, level, line: env.fenceLine ?? (token.map?.[0] ?? 0) + 1 });
  });
}

// 링크가 될 수 있는 구성 요소 필드. 디렉티브(card·figure)는 속성에서, ui: 구성 요소는 해석한 데이터에서 읽는다.
const hrefsOfItems = (data) =>
  Array.isArray(data.items) ? data.items.map((item) => item?.href) : [];
const DIRECTIVE_HREFS = new Set(['card', 'figure']);
const COMPONENT_HREFS = Object.freeze({
  __proto__: null,
  feature: (data) => [data.href],
  figure: (data) => [data.href],
  cards: hrefsOfItems,
  'figure-grid': hrefsOfItems,
});

// 해석한 토큰에서 링크와 이미지 대상을 모은다: 인라인 링크·이미지(줄은 문단 시작 줄에 앞선 줄바꿈 수를 더해 그 링크가 있는 줄),
// card·figure 디렉티브의 href, ui: 구성 요소의 href(구성 요소 펜스 줄). 안쪽 Markdown 필드는 단위마다 같은 일을 한다.
// 대상이 있는지는 호출자가 확인한다(이 해석기는 파일 시스템을 알지 못한다).
function collectLinks({ tokens, env }, shared) {
  const push = (kind, target, line) => {
    if (typeof target === 'string' && target !== '') shared.links.push({ kind, target, line });
  };
  for (const token of tokens) {
    const line = env.fenceLine ?? (token.map?.[0] ?? 0) + 1;
    // 안쪽 구성 요소 필드는 필드 안의 줄이 아니라 기존 진단처럼 구성 요소 펜스 줄에 고정한다.
    if (token.type === 'inline') collectInlineLinks(token, line, push, env.fenceLine === undefined);
    else if (token.type === 'directive' && DIRECTIVE_HREFS.has(token.meta.name)) {
      push('link', token.meta.attrs?.href, line);
    } else if (token.type === 'fence' && token.meta?.role === 'ui') {
      for (const href of COMPONENT_HREFS[token.meta.kind]?.(token.meta.data ?? {}) ?? []) {
        push('link', href, line);
      }
    }
  }
}

function collectInlineLinks(token, firstLine, push, countsBreaks) {
  let line = firstLine;
  for (const child of token.children ?? []) {
    if (countsBreaks && (child.type === 'softbreak' || child.type === 'hardbreak')) line += 1;
    if (child.type === 'link_open') push('link', child.attrGet('href'), line);
    else if (child.type === 'image') push('image', child.attrGet('src'), line);
  }
}
