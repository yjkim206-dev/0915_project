# 검색·AI 검색·공유 이미지 적용 (2026-10-20)

## 이미지

- 파비콘: 기존 기본 템플릿 대신 코랄색 바탕의 입체 말풍선 심볼.
- PNG 16/32/48/192px, ICO, Apple Touch Icon 180px, 브랜드 아이콘 512px.
- OG: `/images/moa-og-v1.jpg`, 1200×630px, 모아 이름·소개·운영 도메인.
- 내장 이미지 생성 도구 사용. 원본과 전체 프롬프트는 `design/branding/` 참조.

## 공개 페이지

- 대표 URL은 `https://onboardproject.shop`.
- 제목·설명·canonical·OG·Twitter Card를 경로별로 제공.
- Vercel `api/seo.mjs`가 빌드된 HTML에 공개 본문과 JSON-LD를 넣어 응답한다.
  사용자와 크롤러가 같은 응답을 받으며, 클라이언트가 기존 React 화면으로 전환한다.
- WebSite, Organization, WebPage/CollectionPage/AboutPage, BreadcrumbList,
  공개 글의 DiscussionForumPosting/Article을 실제 내용으로 작성한다.
- `/about`에 서비스 소개와 실제 이용 방법 FAQ를 공개한다.
- `/sitemap.xml`은 공개 API로 현재 공개 글·공지와 기본 페이지를 조회한다.
  비공개·숨김 글, 관리자·회원·결제결과 페이지는 포함하지 않는다.
- `/robots.txt`, `/llms.txt`로 공개 정보와 접근 범위를 안내한다.
  llms.txt는 보조 안내이며 검색 순위나 AI 인용을 보장하지 않는다.
- 삭제/비공개 글과 알 수 없는 경로는 HTTP 404, 공개 API 장애는 503을 반환한다.

## 검색 제외

- 관리자(`/admin` 전체), 프로필, 로그인·가입·인증, 개인 문의, 글 작성·수정,
  결제 성공/실패 경로에는 `noindex,nofollow,noarchive,nosnippet`을 적용한다.
- 서버 응답 `X-Robots-Tag`와 HTML robots 메타를 함께 적용하고 사이트맵에서 제외한다.
- 관리자는 robots.txt로 크롤링 자체를 막는 대신 noindex 응답을 읽게 한다.
  robots.txt로 차단하면 검색엔진이 noindex를 보지 못해 URL만 노출될 수 있기 때문이다.
- 비공개 응답은 `private,no-store`; 기존 로그인과 API 관리자 권한 검사를 유지한다.
- SEO 렌더러는 인증 없는 공개 API만 사용하고 쿠키·관리자 키를 사용하지 않는다.
- 미리보기는 noindex 처리하며, 기존 `0915-project-ruby.vercel.app` 주소는
  같은 경로의 대표 도메인으로 영구 이동한다.

## 배포·운영

`npm run build`로 정적 자산을 만들고 첫 화면에는 정적 본문과 JSON-LD를 포함한다.
Vercel 함수는 빌드된 HTML을 읽으며, 배포 작업 디렉터리 차이로 파일을 찾지 못하면
고정된 운영 도메인의 정적 `/index.html`을 읽는다. 요청자가 전달한 호스트는 사용하지 않는다.
동적 공개 HTML과 사이트맵 캐시는 60초이며 비공개 응답은 캐시하지 않는다.
이번 변경에는 Supabase DB 변경이나 신규 서버 시크릿이 필요하지 않다.

Google Search Console·네이버 서치어드바이저 소유권 확인과 사이트맵 제출은
해당 운영 계정에서 진행할 수 있다. 검색 노출 여부·시점은 각 검색엔진이 결정한다.
카카오에 이전 미리보기가 남아 있으면 카카오 OG 캐시 초기화 도구를 사용할 수 있다.

## 참고

- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google 검색 제외](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Open Graph](https://ogp.me/)
- [카카오 공유 도구 및 캐시](https://developers.kakao.com/docs/ko/tool/common)
- [Vercel 함수 파일 포함](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions)
