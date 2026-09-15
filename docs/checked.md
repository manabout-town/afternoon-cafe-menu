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
