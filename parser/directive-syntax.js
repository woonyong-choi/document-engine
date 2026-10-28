// Markdown 구성 블록과 코드 펜스가 공유하는 옵션 문법. 해석기는 HTML과 디자인 모듈을 알지 못한다.
// 폭·카드 모양처럼 디자인이 정하는 값 목록은 호출자가 해석 문맥의 vocabulary로 넘긴다.

export const MAX_DEPTH = 3;

const NAME = '[a-z][a-z0-9-]{0,23}';
const OPEN = new RegExp(`^(:{3})(${NAME})(?:\\[([^\\]\\n]*)\\])?(?:\\{(.*)\\})?\\s*$`);
const LEAF = new RegExp(`^::(${NAME})(?:\\[([^\\]\\n]*)\\])?\\{(.*)\\}\\s*$`);
const CLOSE = /^:::\s*$/;
const FLAT = new RegExp(`^(:{2,3})(${NAME})(?:\\[([^\\]\\n]*)\\])?[ \\t]+(?![\\[{])(\\S.*?)\\s*$`);
const KEY = /^[a-z][a-z0-9-]{0,23}/;
const BARE = /^[^\s"'{}=\\]+/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;
const LIMITS = { attributes: 12, value: 300, label: 80 };

// 한 줄을 여는 줄(`:::이름`), 닫는 줄(`:::`), 리프 줄(`::이름`)로 나눈다. 콜론은 셋(블록)과 둘(리프)만 쓴다.
// 블록 줄처럼 보이지만 형식이 틀리면(`::::note` 같은 네 콜론 포함) 'invalid'다.
export function classifyLine(text) {
  if (!text.startsWith('::')) return { kind: 'text' };
  let match = OPEN.exec(text);
  if (match) {
    return {
      kind: 'open',
      name: match[2],
      label: match[3],
      source: match[4],
    };
  }
  if (CLOSE.test(text)) return { kind: 'close' };
  match = LEAF.exec(text);
  if (match) return { kind: 'leaf', name: match[1], label: match[2], source: match[3] };
  match = FLAT.exec(text);
  if (match) {
    return {
      kind: match[1].length === 2 ? 'leaf' : 'open',
      name: match[2],
      label: match[3],
      source: match[4],
      flat: true,
    };
  }
  return text.startsWith(':::') ? { kind: 'invalid' } : { kind: 'text' };
}

export function parseLabel(label, fail) {
  if (label === undefined) return undefined;
  const value = label.trim();
  if (!value || value.length > LIMITS.label || CONTROL.test(value)) {
    fail(`라벨은 1~${LIMITS.label}자의 한 줄이어야 합니다`);
  }
  return value;
}

// `key=값 key="공백 있는 값" flag` 형식. 값은 따옴표 안에서만 `\"`와 `\\`를 쓴다. 중복 키와 제어 문자는 거부한다.
function parseAttributes(source = '', fail) {
  const attrs = Object.create(null);
  let at = skipBlanks(source, 0);
  while (at < source.length) {
    at = skipBlanks(source, readAttribute(source, at, attrs, fail));
  }
  return attrs;
}

// 속성 하나를 읽어 attrs에 넣고 다음 읽을 위치를 돌려준다.
function readAttribute(source, from, attrs, fail) {
  const key = KEY.exec(source.slice(from))?.[0];
  if (!key) fail(`속성 이름이 잘못되었습니다: ${JSON.stringify(source.slice(from, from + 12))}`);
  if (attrs[key] !== undefined) fail(`속성이 겹칩니다: ${key}`);
  if (Object.keys(attrs).length >= LIMITS.attributes) {
    fail(`속성은 ${LIMITS.attributes}개까지 쓸 수 있습니다`);
  }
  const at = from + key.length;
  if (source[at] !== '=') {
    attrs[key] = true;
    return at;
  }
  const read =
    source[at + 1] === '"'
      ? readQuoted(source, at + 2, key, fail)
      : readBare(source, at + 1, key, fail);
  if (source[read.end] !== undefined && source[read.end] !== ' ' && source[read.end] !== '\t') {
    fail(`속성 사이에는 공백이 필요합니다: ${key}`);
  }
  if (CONTROL.test(read.value) || read.value.length > LIMITS.value) {
    fail(`값이 너무 길거나 제어 문자가 있습니다: ${key}`);
  }
  attrs[key] = read.value;
  return read.end;
}

function skipBlanks(source, from) {
  let at = from;
  while (source[at] === ' ' || source[at] === '\t') at += 1;
  return at;
}

function readQuoted(source, from, key, fail) {
  let value = '';
  for (let at = from; ; at += 1) {
    if (at >= source.length) fail(`따옴표가 닫히지 않았습니다: ${key}`);
    const char = source[at];
    if (char === '"') return { value, end: at + 1 };
    if (char !== '\\') {
      value += char;
      continue;
    }
    at += 1;
    if (source[at] !== '"' && source[at] !== '\\') {
      fail(`따옴표 안에서는 \\" 와 \\\\ 만 이스케이프할 수 있습니다: ${key}`);
    }
    value += source[at];
  }
}

function readBare(source, from, key, fail) {
  const value = BARE.exec(source.slice(from))?.[0] ?? '';
  if (!value) fail(`값이 비었습니다: ${key}`);
  return { value, end: from + value.length };
}

// 인라인 `{...}`의 끝을 따옴표를 고려해 찾는다. 닫는 위치(`}`의 다음 인덱스)를 돌려준다.
export function attributeEnd(text, start) {
  let quoted = false;
  for (let at = start + 1; at < text.length && text[at] !== '\n'; at += 1) {
    if (quoted && text[at] === '\\') at += 1;
    else if (text[at] === '"') quoted = !quoted;
    else if (text[at] === '}' && !quoted) return at + 1;
  }
  return -1;
}

// 속성 명세({ 이름: { type, required, values, min, max } })로 값을 검사해 새 객체를 만든다. 명세에 없는 속성은 거부한다.
function validateAttributes(raw, spec, fail, checks) {
  const result = Object.create(null);
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(spec, key)) {
      fail(`허용하지 않는 속성입니다: ${key} (허용: ${Object.keys(spec).join(', ') || '없음'})`);
    }
  }
  for (const [key, rule] of Object.entries(spec)) {
    const value = raw[key];
    if (value === undefined) {
      if (rule.required) fail(`필수 속성이 없습니다: ${key}`);
      continue;
    }
    result[key] =
      rule.type === 'bool'
        ? checkBool(key, value, fail)
        : checkValue(key, rule, value, fail, checks);
  }
  return result;
}

function checkBool(key, value, fail) {
  if (value !== true && value !== 'true' && value !== 'false')
    fail(`${key}는 true 또는 false여야 합니다`);
  return value === true || value === 'true';
}

function checkValue(key, rule, value, fail, checks) {
  if (value === true) fail(`값이 필요한 속성입니다: ${key}`);
  if (rule.type === 'enum') {
    const values = enumValues(rule, checks);
    if (values && !values.includes(value)) fail(`${key}는 ${values.join(', ')} 중 하나여야 합니다`);
  } else if (rule.type === 'int') {
    if (!/^\d{1,4}$/.test(value) || Number(value) < rule.min || Number(value) > rule.max) {
      fail(`${key}는 ${rule.min}~${rule.max}의 정수여야 합니다`);
    }
  } else if (rule.type === 'asset' || rule.type === 'url' || rule.type === 'icon') {
    const problem = checks[rule.type](value);
    if (problem) fail(`${key}: ${problem}`);
  }
  return value;
}

/**
 * 열거형 규칙의 값 목록. values가 문자열이면 호출자가 준 vocabulary의 그 이름 목록이다.
 * 호출자가 목록을 주지 않았으면 undefined이며 해석 단계에서 확인하지 않는다(출력 단계의 디자인 구성 요소가 다시 거부한다).
 */
function enumValues(rule, checks = {}) {
  if (typeof rule.values !== 'string') return rule.values;
  const values = checks.vocabulary?.[rule.values];
  return Array.isArray(values) ? values : undefined;
}

// 폭 값은 호출자가 vocabulary.widths로 준 디자인 정본 목록을 쓴다.
export const WIDTH_OPTION = Object.freeze({ type: 'enum', values: 'widths' });

// `key=값`과 값 없는 참거짓 이름(`rounded`)만 받는다. 명세에 없는 이름은 허용하지 않는 속성이다.
export function parseOptions(source, spec, fail, checks = {}) {
  return validateAttributes(parseAttributes(source, fail), spec, fail, checks);
}
