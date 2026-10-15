// 사용자 테마의 구성 요소 교체를 검사하고 기본 테마와 합친다. 테마는 구성 요소 출력만 바꾸며 해석기에는 닿지 않는다.
import { COMPONENT_SHAPES } from './components.js';

export class ThemeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ThemeError';
  }
}

/**
 * @param {object} baseComponents 기본 테마의 구성 요소 표
 * @param {{ name?: string, components?: object } | undefined} custom 호출자가 고른 테마
 * @returns {object} 교체한 구성 요소 표. 교체가 없으면 기본 표 그대로다
 * @throws {ThemeError} 지원하지 않는 이름이나 함수가 아닌 값을 준 테마. 잘못된 테마는 기본 출력으로 대신하지 않는다
 */
export function resolveComponents(baseComponents, custom) {
  if (custom === undefined) return baseComponents;
  const overrides = custom.components ?? {};
  const merged = { ...baseComponents };
  for (const [name, replacement] of Object.entries(overrides)) {
    if (!Object.hasOwn(COMPONENT_SHAPES, name)) {
      throw new ThemeError(
        `unsupported theme component: ${name} (supported: ${Object.keys(COMPONENT_SHAPES).join(', ')})`,
      );
    }
    merged[name] = checkShape(name, replacement);
  }
  return Object.freeze(merged);
}

function checkShape(name, replacement) {
  const methods = COMPONENT_SHAPES[name];
  if (methods === null) {
    if (typeof replacement !== 'function')
      throw new ThemeError(`theme component ${name} must be a function`);
    return replacement;
  }
  for (const method of methods) {
    if (typeof replacement?.[method] !== 'function') {
      throw new ThemeError(`theme component ${name} must provide ${method}()`);
    }
  }
  return Object.fromEntries(methods.map((method) => [method, replacement[method]]));
}
