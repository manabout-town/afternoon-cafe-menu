# 공식 문서·화면 확인 기록

## 2026-09-15 확인

- API 키: legacy `anon`(JWT) 과 신규 `sb_publishable_…` 둘 다 발급되어 있음(supabase.com/docs/guides/getting-started/migrating-to-new-api-keys). 둘 다 브라우저에 넣어도 되는 공개 키. `.env.test`·`config.js` 는 `sb_publishable_…` 사용.
- 권한(supabase.com/docs/guides/api/securing-your-api): 표는 grant 없이는 Data API로 접근 안 됨. 새 표에 anon/authenticated 권한이 자동으로 붙는지는 프로젝트마다 다르게 바뀌는 중이라 `setup.sql` 은 `revoke all` 후 필요한 권한만 명시적으로 `grant`.
- RLS(supabase.com/docs/guides/database/postgres/row-level-security, …-performance): `(select auth.uid())` 로 감싸는 것을 공식 권장(초당 1회만 평가, initPlan 캐시). `setup.sql` 정책 전부 이 형태 사용.
- 정지(supabase.com/docs/guides/platform/free-project-pausing): Free 플랜은 7일 저활동 시 정지, 정지 후 90일 내 대시보드에서 복구 가능. (constraints.md의 540 응답 코드는 이 문서에 직접 나오지 않음 — pitfall #18 그대로 인용, 별도 재확인 없음.)

## 프로젝트 확인
- 공유 데모 프로젝트의 `public` 스키마에서 `acm_` 로 시작하는 표 없음 확인 후 진행.
- 프로젝트 URL과 `sb_publishable_…` 키 확보(값은 `.env.test` 에만 저장, 여기 적지 않음).

## 적용 후 보안 어드바이저
acm_ 관련 보안 경고 없음 (2026-09-15).

## 2026-09-16 확인 (원고 PART 0~2)

- 정지(supabase.com/docs/guides/platform/free-project-pausing): Free 플랜은 7일간 활동이 적으면 정지, 약 1주 전 경고 메일, 정지 후 90일 안에 대시보드에서 복구. "하루 몇 번의 DB 요청이면 보통 정지를 피한다"(보장 아님). 정지 중 요청은 540(supabase.com/docs/guides/troubleshooting/http-status-codes).
- 무료 활성 프로젝트 2개(supabase.com/pricing "Limit of 2 active projects"). Free 플랜은 DB 백업 내려받기 불가(supabase.com/docs/guides/deployment/going-into-prod).
- 키 위치(supabase.com/docs/guides/getting-started/api-keys): 대부분 프로젝트 Connect 대화상자, 특정 키는 Settings > API Keys. publishable 키가 없으면 "Create new API Keys". legacy anon/service_role은 "Legacy" 탭, 2026년 말까지 동작하나 새 키 사용을 강하게 권장.
- SQL Editor·Connect 대화상자 이름(quickstarts/reactjs). Data API 끄기 설정 이름 "Enable Data API"(api/securing-your-api). 가입 막기 설정 이름 "Allow new users to sign up"(auth/general-configuration). 대시보드 사용자 추가 버튼 이름은 managing-user-data 문서에서 확인 못 함 → 원고에서 헤지.
- Vercel Hobby(vercel.com/docs/plans/hobby, limits/fair-use-guidelines): 비상업·개인 용도 한정, 상업적 사용 예 "Advertising the sale of a product or service", Pro 개발자 좌석 월 $20.
- supabase-js 2.116.0 UMD: URL 앞뒤 공백 trim, 끝 슬래시 자동 보정, https:// 없으면 오류.
