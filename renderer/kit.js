// 구성 요소가 쓰는 도구 묶음. 자산 주소와 크기는 호출자가 준 조회 함수로 해결하며 파일 시스템을 읽지 않는다.

/**
 * @param {{ ui: object, icons: object, svg: object }} theme 불러온 테마
 * @param {{ assets?: { url?(name: string): string, size?(name: string): [number, number] | undefined }, deviceOverlay?: string }} context
 * @param {Map<string, string>} usedAssets 문서가 쓴 자산 이름과 주소. 주소를 얻는 데 성공한 자산만 기록한다
 */
export function createKit(theme, context, usedAssets) {
  const { ui, icons, svg } = theme;
  const { escape, safeUrl, trusted } = ui;

  function asset(name) {
    if (typeof name !== 'string' || !/^[\w.-]+$/.test(name)) {
      throw new Error(`Invalid asset: ${name}`);
    }
    const url = context.assets?.url ? context.assets.url(name) : `/assets/${name}`;
    if (typeof url !== 'string') throw new TypeError(`asset url must be a string: ${name}`);
    safeUrl(url); // 출력 정책을 통과하는 주소만 쓰고 기록한다. 출력할 때 속성에 맞게 이스케이프한다.
    if (!usedAssets.has(name)) usedAssets.set(name, url);
    return url;
  }

  // 호출자가 준 크기는 속성에 그대로 들어가므로 양의 정수 두 개만 받는다. 구멍 난 배열은 두 칸을 직접 읽어 거른다.
  const isDimension = (value) => Number.isSafeInteger(value) && value > 0;
  function imageSize(name) {
    const size = context.assets?.size?.(name);
    if (size === undefined) return undefined;
    if (
      !Array.isArray(size) ||
      size.length !== 2 ||
      !isDimension(size[0]) ||
      !isDimension(size[1])
    ) {
      throw new TypeError(`Invalid image size: ${name}`);
    }
    return [size[0], size[1]];
  }

  function image(name, alt = '', className = '') {
    const url = asset(name);
    const size = imageSize(name);
    const dimensions = size ? ` width="${size[0]}" height="${size[1]}"` : '';
    return `<img${dimensions} class="${escape(className)}" src="${safeUrl(url)}" alt="${escape(alt)}" loading="lazy" decoding="async">`;
  }

  function contentIcon(spec, size = 'card', variant = 'default') {
    const { name, kind } = typeof spec === 'string' ? { name: spec } : spec;
    let badge;
    if (kind !== undefined && size !== 'small') {
      const { kinds } = icons.getIconCatalog();
      if (!Object.hasOwn(kinds, kind)) throw new Error(`unknown icon kind: ${kind}`);
      badge = trusted(svg.renderSvgIcon(icons.readIcon(kinds[kind])));
    }
    const graphic = trusted(svg.renderSvgIcon(icons.readIcon(name, { variant })));
    return String(ui.ContentIcon({ size, graphic, badge }));
  }

  // 기기 틀 위에 겹칠 그림. 호스트가 자산 이름을 주지 않으면 undefined이며 디자인 구성 요소가 겹침 칸을 비운다.
  function deviceOverlay() {
    const name = context.deviceOverlay;
    return name === undefined ? undefined : trusted(image(name, '', 'app-device-overlay'));
  }

  return { ui, escape, safeUrl, trusted, asset, imageSize, image, contentIcon, deviceOverlay };
}
