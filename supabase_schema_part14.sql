-- إضافة: عدّاد عدد الزوار يظهر بأسفل الصفحة الرئيسية. صف واحد بسيط (نفس نمط metal_prices)،
-- يزيد مرّة واحدة فقط لكل جهاز/متصفح (مش كل مرة يفتح فيها الصفحة) عبر علامة بالـ localStorage،
-- حتى ما يتضخّم الرقم بمجرد تحديث الصفحة أو إعادة فتحها من نفس الشخص.
-- (لا تحذف أي جدول أو عمود قديم — هذه إضافة فوق الجداول الموجودة)

create table if not exists site_visits (
  id int primary key default 1,
  count bigint not null default 0,
  constraint site_visits_single_row check (id = 1)
);
insert into site_visits (id, count) values (1, 0) on conflict (id) do nothing;

alter table site_visits enable row level security;
create policy site_visits_public_read on site_visits for select using (true);

grant select on site_visits to anon, authenticated;

-- تسجّل زيارة جديدة (تُستدعى مرّة واحدة فقط لكل متصفح، الحماية من التكرار من جهة الواجهة)
create or replace function increment_site_visit()
returns void as $$
begin
  update site_visits set count = count + 1 where id = 1;
end;
$$ language plpgsql security definer;

grant execute on function increment_site_visit() to anon, authenticated;
