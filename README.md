<h1 align="center">document-engine</h1>

<p align="center">
  Markdown 원문을 토큰과 진단으로 해석하고 테마로 HTML을 출력하는 문서 엔진<br>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 라이선스"></a>
</p>

홈페이지와 다른 문서 화면에서 같은 Markdown 해석·출력 함수를 쓰는 JavaScript 패키지입니다. 호출자는 원문 문자열을 넘기고 HTML, 제목 목록, 진단과 필요한 자산 정보를 받습니다.

> [!NOTE]
> 개발 중입니다. 배포판은 없고 소스를 직접 실행합니다.

## 빠른 시작

Node.js 22.12 이상과 npm이 필요합니다. 저장소의 소스를 직접 실행하므로 별도 빌드 단계는 없습니다.

```sh
git clone https://github.com/woonyong-choi/document-engine.git
cd document-engine
npm ci
node --input-type=module <<'JS'
import { parseDocument, renderDocument } from './index.js';

const document = await parseDocument('# 시작\n\n문서 엔진 예제입니다.\n', {
  id: 'example.md',
  pageId: 'example',
});
const output = await renderDocument(document);

console.log(output.html);
console.log(output.diagnostics);
JS
```

제목과 문단의 HTML, 빈 진단 목록을 출력합니다. 브라우저 화면의 CSS·runtime 연결과 HTML 저장은 호출자가 처리합니다.

패키지로 설치하면 `document-engine`, `document-engine/parser`, `document-engine/preview` 세 진입점만 import할 수 있습니다. 테마 없이 동기로 해석만 하려면 `document-engine/parser`의 `parseDocumentSync`를 쓰세요. 브라우저 작성 화면에서 사이트와 같은 HTML로 미리 보려면 `document-engine/preview`의 `renderPreview`를 쓰세요(코드 강조·도표 컴파일 제외).

앱에서 설치할 때는 디자인(`@woonyong-choi/design-tokens`), 도표 렌더러(`diagramplay`), 엔진의 commit을 함께 고르세요. 디자인은 `^0.2.0`, 도표 렌더러는 `^0.3.0` peer 의존성이며, 도표를 쓰지 않으면 도표 렌더러는 설치하지 않아도 됩니다. npm 레지스트리에는 발행하지 않습니다.

```sh
npm install --save-dev \
  github:woonyong-choi/design-tokens#<commit> \
  github:woonyong-choi/diagramplay#<commit> \
  github:woonyong-choi/document-engine#<commit>
```

`<commit>`은 앱에서 함께 검증한 각 저장소의 전체 SHA로 바꾸세요.

## 해결하는 문제

문서 화면마다 Markdown 해석과 UI 구성 요소 출력을 따로 구현하면 문법과 오류 위치가 달라집니다. 이 패키지는 해석과 출력을 나누고, 앱이 자산 조회와 테마 구성 요소를 주입하도록 합니다. 일반 Markdown을 HTML로 바꾸는 일만 필요하면 markdown-it을 직접 쓸 수 있습니다.

## 작동 방식

1. `parseDocument`가 원문을 markdown-it 토큰, 제목·링크·도표 정보와 진단으로 해석합니다.
2. `renderDocument`가 해석 결과와 테마로 HTML, 제목 목록, 진단과 필요한 자산·runtime 정보를 만듭니다.
3. 호출자가 HTML을 저장하고 CSS·runtime·자산을 문서 화면에 연결합니다.

![원문을 해석한 결과를 테마로 출력하고 호출자가 문서 화면에 연결합니다](docs/assets/document-flow.svg)

해석과 출력은 원문을 바꾸지 않습니다. 도표는 `diagramplay` 펜스로 쓰며 DiagramPlay 렌더러가 원문 그대로 컴파일하고, 문법 복사와 HTML 다운로드에도 입력 원문을 담습니다. 탭 문법(`:::tabs`·`:::platform`·`@tab`·`:::end`, `ui:tabs`·`ui:platform`)은 없앴으며 다른 알 수 없는 블록처럼 위치가 있는 진단으로 반환합니다. 옛 문법(`thinkflow`·`torso` 펜스, `::::tabs`, 약칭 옵션)도 받지 않습니다. 지원하지 않는 아이콘은 진단으로 반환합니다. 전체 계약과 호스트의 책임은 [문서 엔진](docs/design/document-engine.md)에 있습니다.

## 상태

| 있는 것 | 제공 범위 밖 | 다음 |
|---|---|---|
| 해석·출력 API, 기본 테마 연결, 구성 요소 교체, 합성 입력 시험 | npm 레지스트리 배포, 파일 저장, 문서 탐색 화면 | [열린 이슈](https://github.com/woonyong-choi/document-engine/issues) |

다음 기능은 미정입니다. 파일 저장과 문서 탐색 화면은 호출자가 구현합니다. `npm run check`는 코드와 합성 입력을 검사합니다. 홈페이지 원본 비교는 별도 조건이 필요하며 브라우저 화면과 운영 배포는 이 검사 범위에 없습니다. 1.0 전에는 API와 출력 형식이 바뀔 수 있습니다.

## 문서

- [문서 엔진](docs/design/document-engine.md)
  - [해석 문맥](docs/design/document-engine.md#해석-문맥)
  - [문법](docs/design/document-engine.md#문법)
  - [해석 결과](docs/design/document-engine.md#해석-결과)
  - [출력 결과](docs/design/document-engine.md#출력-결과)
  - [구성 요소 교체](docs/design/document-engine.md#구성-요소-교체)
  - [호스트의 책임](docs/design/document-engine.md#호스트의-책임)
  - [검증](docs/design/document-engine.md#검증)
- [전체 문서](docs/README.md)

## 개발

```sh
npm test
npm run lint
```

`npm run check`는 위 두 검사를 한 번에 실행합니다. 시험은 `devDependencies`에 고정한 디자인과 DiagramPlay commit을 사용합니다.

README 흐름 그림은 `docs/assets/document-flow.diagramplay`가 원본입니다. 설치한 DiagramPlay로 다시 만듭니다.

```sh
node node_modules/diagramplay/src/cli.js check docs/assets/document-flow.diagramplay --strict
node node_modules/diagramplay/src/cli.js render docs/assets/document-flow.diagramplay --strict
```

홈페이지 원본 비교를 실행하려면 `HOMEPAGE_SOURCE`에 고정 commit `87af00676f181524d8386c2af39a06554f227325`의 홈페이지 작업본을 지정하세요. 해당 작업본은 의존성이 설치되어 있고 추적 파일이 깨끗해야 합니다. 지정하지 않으면 비교 시험을 건너뜁니다.

## 라이선스

[MIT](LICENSE)
