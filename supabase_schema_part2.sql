-- إضافة: تسجيل الطلب وإنقاص المخزون تلقائيًا وبأمان من داخل قاعدة البيانات
-- (لا تحذف أي جدول قديم — هذه إضافة فوق الجداول الموجودة)

-- 2026-08-05: أعيدت كتابة الدالة بعد مراجعة كود عامة كشفت إنها كانت تثق بالسعر/التكلفة/الكمية
-- القادمة من المتصفح بدون أي تحقق — أي زائر كان يقدر يفرض سعر الطلب اللي بيدفعه، أو يزوّر التكلفة
-- بتقارير الأرباح، أو يرسل كمية سالبة/ضخمة لتصفير أو تضخيم مخزون أي صنف. الآن كل عنصر يُحسب
-- سعره من قاعدة البيانات نفسها (بما فيها حساب سعر أصناف "البيع بالوزن" من metal_gram_prices)،
-- والتكلفة تُقرأ من صف المنتج مباشرة، والكمية والمخزون يتحققان قبل أي إدخال — وهذا كله ضمن نفس
-- المعاملة (transaction) فبيرفض الطلب بالكامل لو أي عنصر فشل، بدل ما يسجّل جزء وين رفض الباقي.
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
  prod record;
  gram record;
  v_qty int;
  v_price numeric;
  v_rate numeric;
begin
  select * into gram from metal_gram_prices where id = 1;

  insert into orders (id, country, payment, customer_name, customer_phone)
  values (p_id, p_country, p_payment, p_customer_name, p_customer_phone);

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid quantity for item %', item->>'id';
    end if;

    -- قفل صف الصنف (for update) لمنع بيع نفس القطعة الأخيرة لزبونين بنفس اللحظة (overselling)
    select * into prod from products where id = (item->>'id') for update;
    if not found then
      raise exception 'product % not found', item->>'id';
    end if;

    if prod.stock < v_qty then
      raise exception 'insufficient stock for product %', prod.id;
    end if;

    if prod.sale_method = 'weight' then
      if prod.metal_type = 'gold' then
        v_rate := case prod.gold_karat
          when 18 then gram.gold_18
          when 21 then gram.gold_21
          when 22 then gram.gold_22
          else 0
        end;
      elsif prod.metal_type = 'silver' then
        v_rate := case prod.silver_type
          when 'male' then gram.silver_male
          when 'female' then gram.silver_female
          else 0
        end;
      else
        v_rate := 0;
      end if;
      v_price := coalesce(prod.weight_grams, 0) * coalesce(v_rate, 0);
      if v_price <= 0 then
        raise exception 'no valid gram rate configured for product %', prod.id;
      end if;
    else
      v_price := prod.price;
    end if;

    insert into order_items (order_id, product_id, qty, size, price, cost, rep)
    values (p_id, prod.id, v_qty, item->>'size', v_price, prod.cost, item->>'rep');
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
