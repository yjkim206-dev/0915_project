# 검색도구 소유권 확인

## Bing / 네이버

`frontend/index.html`의 head에 운영자가 제공한 `msvalidate.01`과
`naver-site-verification` 메타태그를 추가했다. 이 태그는 동적 SEO 교체 영역
밖에 있어 서버 HTML 렌더링과 클라이언트 경로 이동 후에도 유지된다.
배포 후 각 검색도구에서 사이트 소유 확인을 실행한다.

## Google Search Console

제공된 값은 DNS TXT 레코드 형식이다. 도메인 속성은 HTML 메타태그로
확인할 수 없으므로 현재 권한 있는 DNS 제공자인 가비아에 등록한다.

| 필드 | 값 |
| --- | --- |
| 도메인 | onboardproject.shop |
| 유형 | TXT |
| 호스트 | @ |
| 값 | google-site-verification=b7V1dFp8lcm33QIVf8Ehd2WMks9BnX4PwMqhZEWoXeg |
| TTL | 기본값 |

경로: My가비아 → DNS 관리툴 → 도메인 설정 → 레코드 추가 → 저장.
기존 웹사이트 연결 A/CNAME은 수정하지 않고 TXT 레코드를 별도로 추가한다.
DNS 반영 후 Search Console의 확인 버튼을 누른다. 확인 후에도 레코드를 유지한다.
2026-10-20 최초 확인 시 해당 도메인의 TXT 응답에서는 인증값이 조회되지 않았다.

URL 접두어 속성에서 HTML 태그 인증을 사용하려면 Search Console이 해당 방식에
발급한 `<meta name="google-site-verification" ...>` 태그를 사용한다. DNS 인증값을
HTML에 넣는 것만으로 도메인 속성의 DNS 확인을 대신할 수 없다.

사이트맵 제출 주소: https://onboardproject.shop/sitemap.xml

- [Google 소유권 확인](https://support.google.com/webmasters/answer/9008080?hl=ko)
- [가비아 DNS 설정](https://customer.gabia.com/faq/detail/287/1201)
