-- إضافة: نظام قواعد التصنيفات (المرحلة الثانية) — يسمح للزبون بطلب مقاس مختلف للخاتم عند الدفع،
-- فقط للمنتجات اللي مصدرها لبنان (الورشة المركزية القادرة على تفصيل مقاس مختلف)، ويُسجَّل الطلب
-- كملاحظة نصية اختيارية على صنف الطلب نفسه.
-- (لا تحذف أي جدول أو عمود قديم — هذه إضافة فوق الجداول الموجودة)

alter table order_items add column if not exists size_note text;

-- إضافة size_note لعرض order_items_customer (نفس درس المرحلة الأولى: الأعمدة الجديدة لازم
-- تُضاف بآخر قائمة SELECT، مش وسطها، وإلا CREATE OR REPLACE VIEW يرفض بخطأ 42P16)
create or replace view order_items_customer as
  select oi.id, oi.order_id, oi.product_id, oi.qty, oi.size, oi.price, oi.size_note
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.customer_id = auth.uid();

grant select on order_items_customer to anon, authenticated;

-- إعادة إنشاء place_order لتسجيل ملاحظة المقاس المرسلة مع كل صنف (اختيارية، نص حر) — نوع القيمة
-- المرجعة (bigint) ما تغيّر، فـ create or replace تكفي هون (بعكس المرحلة السابقة لما تغيّر النوع)
create or replace function place_order(
  p_id text,
  p_country text,
  p_payment text,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb
) returns bigint as $$
declare
  item jsonb;
  prod record;
  gram record;
  v_qty int;
  v_price numeric;
  v_rate numeric;
  v_invoice_number bigint;
begin
  select * into gram from metal_gram_prices where id = 1;

  insert into orders (id, country, payment, customer_name, customer_phone, customer_id)
  values (p_id, p_country, p_payment, p_customer_name, p_customer_phone, auth.uid())
  returning invoice_number into v_invoice_number;

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

    -- ملاحظة: خصم المخزون يصير تلقائيًا عبر trigger موجود أصلًا (trg_decrement_stock على order_items)
    insert into order_items (order_id, product_id, qty, size, price, cost, rep, size_note)
    values (p_id, prod.id, v_qty, item->>'size', v_price, prod.cost, item->>'rep', nullif(item->>'size_note', ''));
  end loop;

  return v_invoice_number;
end;
$$ language plpgsql security definer;

revoke execute on function place_order(text, text, text, text, text, jsonb) from public;
revoke execute on function place_order(text, text, text, text, text, jsonb) from anon;
grant execute on function place_order(text, text, text, text, text, jsonb) to authenticated;
