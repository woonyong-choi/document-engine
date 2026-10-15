// 문서 구조를 비교 가능한 값으로 바꾼다. 출력이 문서를 바꾸지 않았는지 확인할 때 쓴다.

/** @param {object[]} tokens markdown-it 토큰 목록 */
export function snapshotTokens(tokens) {
  return tokens.map((token) => ({
    type: token.type,
    tag: token.tag,
    attrs: token.attrs?.map((pair) => [...pair]) ?? null,
    map: token.map,
    nesting: token.nesting,
    level: token.level,
    content: token.content,
    info: token.info,
    markup: token.markup,
    hidden: token.hidden,
    meta: snapshotMeta(token.meta),
    children: token.children ? snapshotTokens(token.children) : null,
  }));
}

function snapshotMeta(meta) {
  if (meta === null || meta === undefined) return meta ?? null;
  if (Array.isArray(meta)) return meta.map(snapshotMeta);
  if (typeof meta !== 'object') return meta;
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [
      key,
      key === 'units' ? snapshotUnits(value) : snapshotMeta(value),
    ]),
  );
}

function snapshotUnits(units) {
  return units.map((unit) => ({
    path: unit.path,
    inline: unit.inline,
    tokens: snapshotTokens(unit.tokens),
  }));
}
