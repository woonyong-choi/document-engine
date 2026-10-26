// 같은 낱말 표식 `::강조::`, `==강조==`의 경계 판단. 인라인 규칙과 블록 줄 판별이 같은 조건을 쓴다.
const BACKSLASH = String.fromCharCode(92);

// 닫는 표식의 위치. 역슬래시로 이스케이프한 표식은 건너뛴다. 없으면 -1이다.
function findClosingMarker(src, from, marker) {
  let end = from;
  while ((end = src.indexOf(marker, end)) !== -1) {
    let escapes = 0;
    for (let at = end - 1; at >= 0 && src[at] === BACKSLASH; at -= 1) escapes += 1;
    if (escapes % 2 === 0) return end;
    end += marker.length;
  }
  return -1;
}

/**
 * start에서 시작하는 강조의 닫는 표식 위치. 공백으로 시작하거나 끝나는 표식, 줄을 넘는 표식은 강조가 아니며 -1이다.
 * @param {string} src
 * @param {number} start 여는 표식의 위치
 * @param {string} marker `::` 또는 `==`
 */
export function findMarkEnd(src, start, marker) {
  const first = src[start + marker.length] ?? ' ';
  if (
    src.slice(start, start + marker.length) !== marker ||
    /\s/.test(first) ||
    first === marker[0]
  ) {
    return -1;
  }
  const end = findClosingMarker(src, start + marker.length, marker);
  if (end < 0 || /\s/.test(src[end - 1]) || src.slice(start + marker.length, end).includes('\n')) {
    return -1;
  }
  return end;
}
