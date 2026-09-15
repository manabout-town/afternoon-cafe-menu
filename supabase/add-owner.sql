-- 사장님 계정을 "사장님 명단"에 올립니다.
-- 먼저 Supabase 대시보드의 Authentication 메뉴에서 사장님 계정(이메일+비밀번호)을 만든 뒤 실행하세요.
-- 아래 따옴표 안을 그 계정의 이메일로 바꾸세요.
insert into public.acm_owners (user_id)
select id from auth.users where email = '사장님-이메일을-여기에'
on conflict do nothing;

-- 결과가 0이면 이메일 철자를 확인하세요.
select count(*) as owners
from public.acm_owners o
join auth.users u on u.id = o.user_id
where u.email = '사장님-이메일을-여기에';
