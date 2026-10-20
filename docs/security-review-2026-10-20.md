# 보안 점검 및 조치 — 2026-10-20

## 범위와 방법

- 대상: `onboardproject.shop`, 연결된 Vercel 프로젝트와 Supabase 프로젝트
  `ymprvqsfpwvoutwozwvn`의 애플리케이션/API/Data API.
- 운영자 요청에 따라 임시 계정 두 개와 해당 계정의 게시글·댓글로 검증했다.
  타 회원 데이터를 열람·변경하지 않았고 실제 결제, 환불, 대량 요청, 시간 지연 SQL,
  서비스 중단 공격이나 제3자 서비스 공격은 실행하지 않았다.
- 계정과 게시글은 각 검증 실행의 finally 절에서 삭제하고 삭제 여부를 확인했다.
- 비밀값은 출력하거나 보고서에 기록하지 않았다.

## 확인한 문제와 수정

| 문제 | 확인 근거 | 조치 |
| --- | --- | --- |
| 숨김 글의 DB 뷰 직접 조회 | 임시 숨김 글을 `post_list`에서 익명·일반회원으로 조회할 수 있었음 | 마이그레이션 022: 뷰를 security_invoker로 변경, public/anon/authenticated 직접 접근 회수, service_role만 SELECT |
| 숨김 글의 하위 API 접근 | 본문은 404였지만 댓글·반응 GET은 200이었음 | 부모 글의 공개 여부/작성자 여부를 먼저 확인, 무권한 접근은 404 |
| 결제 원본 응답 열의 과도한 권한 | own-row RLS와 별개로 authenticated에 원본 결제 응답 열 SELECT 권한이 있었음 | 마이그레이션 023: 결제키와 provider JSON 읽기 회수, 안전한 주문 열만 허용. 사용자 UI는 기존 allowlist API 이용 |
| 내부 오류 메시지 반환 | 예외 메시지가 API 응답에 그대로 실릴 수 있었음 | 500 오류는 일반 메시지로 응답. 상세 원인은 서버 로그에만 기록 |
| 과도한 숫자 ID | 숫자 라우트가 JS의 안전한 정수 범위를 검사하지 않았음 | 0 또는 안전한 정수 범위 밖의 ID는 DB 조회 전에 400 |
| 보안 응답 헤더 부족 | 프레임 삽입/객체 콘텐츠/리퍼러 정책이 명시되지 않았음 | SAMEORIGIN, frame-ancestors, base-uri, object-src, nosniff, Referrer-Policy 추가 |
| source-map-js 취약 버전 | npm audit에서 개발/빌드 의존성 high 1건 발견 | 1.2.1 → 1.2.2 업데이트, 재감사 0건 |

보안 헤더의 CSP는 프레임·base·object 제한이다. 전체 script-src 정책을 적용했다고
주장하지 않으며, Toss/Kakao 정상 연동을 막는 포괄적인 스크립트 차단은 추가하지 않았다.

## 인젝션·권한 검증 결과

실제 배포 API/Data API/브라우저 검증 **32건 통과**:

- SQL 인젝션 형태의 로그인: 인증 실패, 토큰 발급 없음.
- 위조 JWT, 익명, 일반회원: 관리자 사용자 API 접근 거부.
- author_id/role 추가 입력: 게시글 소유권 위조·관리자 승격 불가.
- 다른 회원 게시글 변경 거부.
- 무해한 표식만 설정하는 XSS 문자열을 임시 글에 저장: 서버 HTML에서 이스케이프,
  실제 Edge 브라우저에서 React 렌더링 후에도 문자열로 표시되고 실행되지 않음.
- 숨김 글의 본문·댓글·반응: 익명·타 회원 모두 404.
- post_list 직접 조회: 익명 401, 일반회원 403, 임시 숨김 글 반환 없음.
- 프로필 직접 PATCH: 관리자 역할로 바뀌지 않았음을 DB에서 확인.
- 크레딧 관리 RPC, 빌링키, 원본 결제 응답 직접 읽기: 거부.
- 자신의 안전한 주문 요약 열: 200 유지.
- SQL 문법을 넣은 경로, prototype pollution, 공개 갱신 워커 요청: 거부.
- SEO 렌더러에 절대 URL을 전달하는 요청: 400, 비밀 파일 경로 요청: 404.

익명 키가 있는 요청의 401/403 차이는 Supabase/PostgREST 처리에 따라 달라질 수 있다.
프로필 PATCH의 204만으로 권한 상승 여부를 판단하지 않고 실제 role 값이 user인지 확인했다.

## 키 노출과 하드코딩

- 루트·로컬·프론트·백엔드 환경파일의 현재 비밀값과 주요 토큰 패턴을 사용해
  추적 파일, Git의 도달 가능한 이력, 공개 JS/CSS를 검사했다. 발견된 비밀값은 없었다.
- 검사 대상: Supabase 계정 토큰·service-role/secret 키, Toss 시크릿,
  Vercel 접근 토큰, 관리자 비밀번호, 갱신 워커 시크릿, 알려진 GitHub/OpenAI 키 패턴.
- `.env`는 추적 대상이 아니며 외부 요청으로도 제공되지 않았다.
- 프론트의 Supabase anon/publishable 키와 Toss client 키, 검색도구 인증 태그는
  공개용 값이다. 시크릿과 구분하며, 공개 anon 키의 안전성은 DB 권한/RLS로 보완한다.
- 대표 도메인과 Supabase 프로젝트 URL은 `deploymentConfig.js`와 SEO 공통 설정에
  명시되어 있다. 이는 공개 운영 설정이며, 임의 호스트/프로젝트로 요청이 이동하지
  않도록 고정한 값이다. 브랜드 문구와 테스트 모드 제한도 코드상 고정되어 있다.
- 상품 금액·주문·이용권·크레딧 처리는 서버/DB 값을 사용한다. 테스트 파일의
  기대 금액·가짜 응답은 운영 인증키가 아니다.

## 재실행

```text
npm.cmd --prefix backend test
node backend/test/security-secrets.mjs --deployed
npx.cmd --yes --package=playwright -c "node backend/test/security-integration.mjs --allow-remote-fixtures --strict --browser"
npm.cmd --prefix frontend audit --json
npm.cmd run build
```

API 회귀 검증 32건, 실제 보안 검증 32건 통과. 프론트 빌드 성공.
시크릿 검사는 알려진 현재 값과 식별 가능한 패턴 기준이며 알 수 없는 모든 토큰이나
과거 외부 유출·침해 여부를 증명하는 포렌식 검사는 아니다. 로그인 추측/부하/서비스
중단 공격과 제3자 인증·결제 서비스 자체에 대한 검증은 수행하지 않았다.

## 사이트맵 점검

신고 당시 직접 조회에서는 XML 200, 공개 URL 9개였으며 검색봇 User-Agent 요청도
200이었다. 이는 실제 Google IP의 요청 성공이나 Search Console 상태를 증명하지는 않는다.
정적 인덱스와 정적 기본 페이지 목록, 동적 공개 글 목록으로 분리해 첫 응답의 DB
의존성을 없앴다. 제출 주소는 `https://onboardproject.shop/sitemap.xml` 그대로이다.

## 참고

- [Supabase RLS와 뷰](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase 열 접근 권한](https://supabase.com/docs/guides/database/column-level-security)
- [source-map-js 패치 공지](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- [Google 사이트맵 가져오기 오류](https://support.google.com/webmasters/answer/7451001)
