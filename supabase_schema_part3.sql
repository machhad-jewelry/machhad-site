-- إضافة: عدّاد مشاهدات لكل صنف، لعرض سلايد "الأكثر مشاهدة" بالصفحة الرئيسية
-- (لا تحذف أي جدول قديم — هذه إضافة فوق الجداول الموجودة)

alter table products add column if not exists views integer not null default 0;

create or replace function increment_product_view(p_id text)
returns void as $$
begin
  update products set views = views + 1 where id = p_id;
end;
$$ language plpgsql security definer;

grant execute on function increment_product_view(text) to anon, authenticated;
