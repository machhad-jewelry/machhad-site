-- إضافة: تسجيل الطلب وإنقاص المخزون تلقائيًا وبأمان من داخل قاعدة البيانات
-- (لا تحذف أي جدول قديم — هذه إضافة فوق الجداول الموجودة)

create or replace function place_order(
  p_id text,
  p_country text,
  p_payment text,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb
) returns void as $$
declare
  item jsonb;
begin
  insert into orders (id, country, payment, customer_name, customer_phone)
  values (p_id, p_country, p_payment, p_customer_name, p_customer_phone);

  for item in select * from jsonb_array_elements(p_items) loop
    insert into order_items (order_id, product_id, qty, size, price, cost, rep)
    values (
      p_id,
      item->>'id',
      (item->>'qty')::int,
      item->>'size',
      (item->>'price')::numeric,
      (item->>'cost')::numeric,
      item->>'rep'
    );
  end loop;
end;
$$ language plpgsql security definer;

grant execute on function place_order(text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function decrement_product_stock()
returns trigger as $$
begin
  if new.product_id is not null then
    update products set stock = greatest(stock - new.qty, 0) where id = new.product_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_decrement_stock on order_items;
create trigger trg_decrement_stock
after insert on order_items
for each row execute function decrement_product_stock();
