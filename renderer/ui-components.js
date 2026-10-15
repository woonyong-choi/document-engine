// ui: 코드 펜스의 구성 요소 출력. 해석기가 보존한 YAML 데이터와 안쪽 Markdown 출력으로 구성 요소 하나를 만든다.
// 안쪽 Markdown은 이미 해석된 토큰을 그리기만 하며 다시 해석하지 않는다.

const CARD_VARIANTS = ['centered', 'grouped', 'inline', 'related'];

/**
 * @typedef {object} ComponentContext
 * @property {string} id 구성 요소 ID
 * @property {(path: string) => string} html 안쪽 Markdown 필드의 출력
 * @property {(name: string, method: string | undefined, props: object) => string} call 구성 요소 호출
 * @property {(name: string, method: string | undefined, props: object) => { html: string, failed: boolean }} attempt 성공 여부까지 돌려주는 호출
 * @property {object} kit 자산·아이콘 도구와 디자인 정본 ui
 */

const body = (item, rc, index) => rc.kit.trusted(rc.html(`items.${index}.body`));

function player(data, rc, controls = false) {
  const { ui, asset } = rc.kit;
  return ui.Player({
    id: rc.id,
    src: asset(data.src),
    poster: asset(data.poster),
    title: data.title,
    width: data.width,
    height: data.height,
    controls,
    overlay: data.overlay,
    wide: data.wide,
  });
}

function remote(rc, src = '') {
  const { ui, asset } = rc.kit;
  return ui.RemoteButton({
    id: rc.id,
    src: src ? asset(src) : undefined,
    icon: ui.ControlIcon('play'),
  });
}

const overlay = ({ kit }) =>
  kit.trusted(kit.image('bezel-iphone6-overlay.svg', '', 'app-device-overlay'));

function feature(data, rc) {
  const { ui, trusted, escape, image } = rc.kit;
  const heading = ui.SectionIntro({
    icon: data.icon ? trusted(image(data.icon, '')) : undefined,
    title: data.title,
    description: trusted(`<p>${escape(data.description)}</p>`),
    action: data.href ? { href: data.href, label: data.link } : undefined,
  });
  return ui.FeatureSection({
    tone: data.tone,
    split: data.split,
    heading,
    body: trusted(rc.html('body')),
    descriptions:
      data.left || data.right
        ? [
            { title: data.leftTitle, body: data.left },
            { title: data.rightTitle, body: data.right },
          ]
        : [],
  });
}

function device(data, rc) {
  const { ui, trusted, image } = rc.kit;
  const screen = data.video ? player(data, rc) : image(data.src, data.title ?? '기기 화면');
  const frame = ui.Device({
    screen: trusted(screen),
    overlay: overlay(rc),
    label: data.title ?? 'iPhone 화면',
  });
  return `${frame}${data.video ? ui.MediaControls({ remote: trusted(remote(rc)) }) : ''}`;
}

function demos(data, rc) {
  const { ui, trusted } = rc.kit;
  const items = data.items.map((item, index) => ({
    title: item.title,
    body: body(item, rc, index),
    action: data.singleControl ? undefined : trusted(remote(rc, item.src)),
  }));
  const screen = player({ ...data, src: data.src ?? data.items[0].src }, rc);
  const media = `${ui.Device({ screen: trusted(screen), overlay: overlay(rc), figure: true })}${
    data.singleControl ? ui.MediaControls({ remote: trusted(remote(rc)) }) : ''
  }`;
  return ui.FeatureDemos({
    items,
    media: trusted(media),
    after: data.after ? trusted(rc.html('after')) : undefined,
  });
}

// 열기·닫기 한 쌍. 열기가 실패하면 오류 표시와 안쪽 내용만 내고 닫기는 부르지 않는다. 성공 여부는 쌍마다 따로 쥔다.
function paired(rc, name, props, inner, closeProps = {}) {
  const open = rc.attempt(name, 'open', props);
  const body = inner();
  return open.html + body + (open.failed ? '' : rc.call(name, 'close', closeProps));
}

function callout(data, rc) {
  const props = { title: data.title ?? 'Note', tone: data.tone, fineprint: data.fineprint };
  return paired(rc, 'callout', props, () => rc.html('body'));
}

function details(data, rc) {
  const { escape } = rc.kit;
  const { call } = rc;
  const open = rc.attempt('details', 'open', { open: data.open });
  if (open.failed) return open.html + rc.html('body');
  const summaryOpen = rc.attempt('details', 'summaryOpen', {});
  const summary =
    summaryOpen.html +
    escape(data.title) +
    (summaryOpen.failed ? '' : call('details', 'summaryClose', {}));
  return open.html + summary + rc.html('body') + call('details', 'close', {});
}

function figureGrid(data, rc) {
  if (!Array.isArray(data.items) || !data.items.length)
    throw new Error('ui:figure-grid needs items');
  const figures = data.items.map((item) => rc.kit.trusted(rc.call('figure', undefined, item)));
  return rc.kit.ui.FigureGrid({ columns: data.columns, size: data.size, figures });
}

function tabs(data, rc, platform) {
  if (!Array.isArray(data.items) || !data.items.length) throw new Error('Tabs require items');
  const props = {
    id: rc.id,
    label: data.title ?? '기기별 안내',
    platform,
    labels: data.items.map((item) => item.label),
    ...(platform ? {} : { position: 'top', selector: 'segmented' }),
    selected: 0,
    width: rc.kit.ui.contentWidth({}),
  };
  const panels = () =>
    data.items
      .map((item, index) =>
        paired(rc, 'tab', { id: rc.id, index, selected: 0 }, () => rc.html(`items.${index}.body`)),
      )
      .join('');
  return paired(rc, 'tabs', props, panels, props);
}

function cards(data, rc) {
  if (data.variant && !CARD_VARIANTS.includes(data.variant))
    throw new Error(`Unknown card variant: ${data.variant}`);
  const html = data.items.map((item) =>
    rc.call('card', undefined, {
      horizontal: data.horizontal,
      ...item,
      variant: item.variant ?? data.variant,
    }),
  );
  if (data.split) {
    return rc.kit.ui.CardGroup({
      variant: data.variant,
      columns: data.columns,
      split: data.split,
      cards: html.map((card) => rc.kit.trusted(card)),
    });
  }
  const props = { variant: data.variant, columns: data.columns };
  return paired(rc, 'cards', props, () => html.join(rc.call('cards', 'gap', props)), props);
}

/** ui: 종류별 출력. 값은 HTML 문자열이나 Trusted다. */
export const UI_RENDERERS = Object.freeze({
  __proto__: null,
  group: (data, rc) =>
    rc.kit.ui.ContentGroup({ title: data.title, body: rc.kit.trusted(rc.html('body')) }),
  feature,
  'syntax-examples': (data, rc) =>
    rc.kit.ui.SyntaxExamples({
      items: data.items.map((item, index) => ({ ...item, body: body(item, rc, index) })),
    }),
  'feature-list': (data, rc) =>
    rc.kit.ui.FeatureList({
      items: data.items.map((item, index) => ({ ...item, body: body(item, rc, index) })),
    }),
  device,
  demos,
  'feature-pair': (data, rc) =>
    rc.kit.ui.FeatureDemos({
      items: data.items.map((item, index) => ({ ...item, body: body(item, rc, index) })),
      media: rc.kit.trusted(rc.html('media')),
      mediaFirst: data.mediaFirst,
    }),
  callout,
  details,
  figure: (data, rc) => rc.call('figure', undefined, data),
  fineprint: (data, rc) => rc.kit.ui.Fineprint({ text: rc.kit.trusted(rc.html('body')) }),
  'figure-grid': figureGrid,
  video: (data, rc) =>
    rc.call('video', undefined, {
      id: rc.id,
      src: data.src,
      poster: data.poster,
      title: data.title,
      caption: data.caption,
      playerWidth: data.width,
      playerHeight: data.height,
      playerWide: data.wide,
    }),
  gallery: (data, rc) => rc.call('gallery', undefined, { ...data, id: rc.id }),
  platform: (data, rc) => tabs(data, rc, true),
  tabs: (data, rc) => tabs(data, rc, false),
  cards,
  definitions: (data, rc) =>
    rc.kit.ui.Definitions({
      items: data.items.map((item, index) => ({ term: item.term, body: body(item, rc, index) })),
    }),
  speech: (data, rc) => rc.kit.ui.Speech({ text: data.body }),
  keys: (data, rc) => rc.kit.ui.Shortcut({ label: data.label, keys: data.keys }),
  tooltip: (data, rc) =>
    rc.kit.ui.TooltipBlock({
      id: `${rc.id}-tip`,
      label: data.label,
      body: rc.kit.trusted(rc.html('description')),
    }),
});
