// 시험용 합성 자산 목록. 개인 문서 폴더의 자산을 읽지 않는다.
export const ASSET_NAMES = Object.freeze([
  '2-today-mac.png',
  '3-upcoming-iphone.mp4',
  '3-upcoming-iphone.png',
  '3-upcoming-mac-2.mp4',
  '3-upcoming-mac-2.png',
  '4-headings-mac.png',
  '5-checklists-mac-2.png',
  '7-quickfind-mac.png',
  '10-reminders-mac.png',
  'repeating-comparison-1-io80.png',
  'repeating-comparison-2-io80.png',
]);

export const IMAGE_SIZES = Object.freeze({
  '2-today-mac.png': [640, 480],
  '3-upcoming-mac-2.png': [320, 200],
});

export const assets = Object.freeze({
  exists: (name) => ASSET_NAMES.includes(name),
  size: (name) => IMAGE_SIZES[name],
});
