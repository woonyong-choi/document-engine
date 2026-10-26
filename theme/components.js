// 기본 테마의 지원 구성 요소. 모든 항목은 `(props, kit)`을 받아 HTML 문자열을 돌려준다.
// props는 JSON으로 표현할 수 있는 값이며 kit.ui는 디자인 정본 구성 요소다. 사용자 테마는 이 이름 중 일부를 같은 모양으로 바꾼다.

/** 사용자 테마가 바꿀 수 있는 구성 요소와 필요한 함수. 문자열은 `name.method` 형식이다. */
export const COMPONENT_SHAPES = Object.freeze({
  tabs: ['open', 'close'],
  tab: ['open', 'close'],
  callout: ['open', 'close'],
  steps: ['open', 'close'],
  cards: ['open', 'close', 'gap'],
  details: ['open', 'close', 'summaryOpen', 'summaryClose'],
  table: ['open', 'close'],
  card: null,
  gallery: null,
  figure: null,
  video: null,
  code: null,
  kbd: null,
  menu: null,
  icon: null,
  tip: null,
});

/** 카드 아이콘 입력(`content:이름`, 객체, 문서 아이콘 이름)을 아이콘 HTML로 바꾼다. */
function iconHtml(name = 'question', kit) {
  if (typeof name === 'object' && name !== null) return kit.contentIcon(name);
  if (typeof name === 'string' && name.startsWith('content:'))
    return kit.contentIcon(name.slice(8));
  return String(kit.ui.ArticleIcon(name));
}

function cardMark(props, kit) {
  if (props.variant === 'related') {
    const name =
      typeof props.icon === 'string' && props.icon.startsWith('content:')
        ? props.icon.slice(8)
        : undefined;
    return name ? kit.contentIcon(name, 'small') : '';
  }
  return props.icon === false ? '' : iconHtml(props.icon, kit);
}

function card(props, kit) {
  // 카드 모양 이름은 디자인 정본 Card가 검사한다.
  const { variant } = props;
  const mark = cardMark(props, kit);
  return String(
    kit.ui.Card({
      href: props.href,
      title: props.title,
      description: props.description,
      icon: mark ? kit.trusted(mark) : undefined,
      variant,
      compact: props.compact,
      horizontal: props.horizontal,
      headingLevel: props.headingLevel,
    }),
  );
}

function gallery(props, kit) {
  const slides = Array.isArray(props.slides)
    ? props.slides.map((slide) => ({
        image: kit.trusted(kit.image(slide.src, slide.alt ?? slide.label)),
        caption: slide.caption,
        label: slide.label,
      }))
    : props.slides;
  return String(
    kit.ui.Gallery({
      id: props.id,
      title: props.title,
      width: kit.ui.contentWidth(props),
      selected: props.selected,
      slides,
    }),
  );
}

function figure(props, kit) {
  return String(
    kit.ui.Figure({
      media: kit.trusted(kit.image(props.src, props.alt, props.rounded ? 'is-rounded' : '')),
      href: props.href,
      caption: props.caption ?? '',
      width: kit.ui.contentWidth(props),
    }),
  );
}

function video(props, kit) {
  return String(
    kit.ui.Video({
      id: props.id,
      src: kit.asset(props.src),
      poster: kit.asset(props.poster),
      title: props.title,
      caption: props.caption ?? '',
      frame: props.frame === 'iphone' ? 'iphone' : undefined,
      playerWidth: props.playerWidth,
      playerHeight: props.playerHeight,
      playerWide: props.playerWide,
      width: kit.ui.contentWidth(props),
      deviceOverlay: kit.deviceOverlay(),
    }),
  );
}

function code(props, kit) {
  return String(
    kit.ui.CodeBlock({
      code: kit.trusted(props.code),
      language: props.language,
      filename: props.filename,
      width: props.width,
    }),
  );
}

/** @returns {object} 기본 구성 요소 표 */
export function createDefaultComponents() {
  return Object.freeze({
    tabs: {
      open: (props, { ui }) => ui.Tabs.open(props),
      close: (props, { ui }) => ui.Tabs.close(props),
    },
    tab: {
      open: (props, { ui }) => ui.Tabs.panelOpen(props),
      close: (props, { ui }) => ui.Tabs.panelClose(),
    },
    callout: {
      open: (props, { ui }) => ui.Callout.open(props),
      close: (props, { ui }) => ui.Callout.close(),
    },
    steps: {
      open: (props, { ui }) => ui.Steps.open(),
      close: (props, { ui }) => ui.Steps.close(),
    },
    cards: {
      open: (props, { ui }) => ui.CardGroup.open(props),
      close: (props, { ui }) => ui.CardGroup.close(),
      gap: (props, { ui }) => ui.CardGroup.gap(props.variant),
    },
    details: {
      open: (props, { ui }) => ui.Details.open(props),
      close: (props, { ui }) => ui.Details.close(),
      summaryOpen: (props, { ui }) => ui.Details.summaryOpen(),
      summaryClose: (props, { ui }) => ui.Details.summaryClose(),
    },
    table: {
      open: (props, { ui }) => ui.Table.open(),
      close: (props, { ui }) => ui.Table.close(),
    },
    card,
    gallery,
    figure,
    video,
    code,
    kbd: (props, { ui }) => String(ui.Kbd({ text: props.label })),
    menu: (props, { ui }) => String(ui.Menu({ text: props.label })),
    icon: (props, kit) =>
      String(kit.ui.InlineIcon({ icon: kit.trusted(kit.contentIcon(props.label, 'small')) })),
    tip: (props, { ui }) =>
      String(ui.Tooltip({ id: `${props.id}-tip`, label: props.label, text: props.text })),
  });
}
