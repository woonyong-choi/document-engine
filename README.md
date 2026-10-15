# document-engine

Markdown 원문을 구조·진단으로 해석하고 테마로 HTML을 출력하는 문서 엔진입니다. 홈페이지가 고정 commit의 Git 의존성으로 소비합니다. npm 레지스트리에는 발행하지 않습니다.

## 구성

| 경로 | 내용 |
|---|---|
| parser | 원문 → markdown-it 토큰, metadata, 진단 |
| renderer | 토큰 + 테마 → HTML, 자산, runtime, 진단 |
| theme | 기본 테마 연결과 구성 요소 교체 |
| test | 계약·출력·배포 파일·홈페이지 원본 비교 시험 |

계약과 배포 방식은 [문서 엔진 설계](docs/design/document-engine.md)에 있습니다.

## 설치

디자인(`@woonyong-choi/design-tokens`)과 도표 렌더러(`thinkflow`)는 peer 의존성입니다. 쓰는 앱이 세 패키지의 commit을 함께 고릅니다.

```sh
npm install --save-dev \
  github:woonyong-choi/design-tokens#<commit> \
  github:woonyong-choi/thinkflow#<commit> \
  github:woonyong-choi/document-engine#<commit>
```

## 개발

Node.js 22.12 이상이 필요합니다. 시험은 `devDependencies`에 고정한 디자인과 ThinkFlow commit으로 실행하며 빌드 단계나 환경변수가 필요 없습니다.

```sh
npm ci
npm run check   # prettier, eslint, node:test
```

홈페이지 원본 비교 시험은 `HOMEPAGE_SOURCE`가 고정 commit에 있고 추적 파일이 깨끗한 홈페이지 작업본을 가리킬 때만 실행되며, 없으면 건너뜁니다.

## 라이선스

[MIT](LICENSE)
