-- إضافة: نظام ترقيم فواتير حقيقي ومستقل عن رقم الطلب + معلومات تواصل المتجر (تُستخدم بفاتورة الـ PDF)
-- (لا تحذف أي جدول أو عمود قديم — هذه إضافة فوق الجداول الموجودة)

-- رقم فاتورة تسلسلي حقيقي، مستقل عن معرّف الطلب (S-...)، يُولَّد تلقائيًا عند إنشاء الطلب.
-- جدول orders فاضي حاليًا (تم تصفير كل الطلبيات هذا الأسبوع) فالترقيم بيبلش نظيف من 1 ومطابق
-- تمامًا لترتيب إنشاء الطلبيات.
alter table orders add column if not exists invoice_number bigint generated always as identity;
create unique index if not exists orders_invoice_number_key on orders (invoice_number);

-- معلومات تواصل المتجر تُدار من نفس تبويب "محتوى الموقع" — تُستخدم بترويسة/تذييل فاتورة الـ PDF
-- (اسم النطاق نفسه machhadjewelry.com يبقى ثابت بالكود، مش عمود بقاعدة البيانات)
alter table site_settings add column if not exists store_phone text;
alter table site_settings add column if not exists store_address text;

-- إعادة إنشاء place_order بحيث ترجع رقم الفاتورة الجديد للطلب فور إنشائه (يحتاج drop لأن تغيير
-- نوع القيمة المرجعة من void إلى bigint ما بيصير بـ create or replace وحدها)
drop function if exists place_order(text, text, text, text, text, jsonb);

create function place_order(
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
    insert into order_items (order_id, product_id, qty, size, price, cost, rep)
    values (p_id, prod.id, v_qty, item->>'size', v_price, prod.cost, item->>'rep');
  end loop;

  return v_invoice_number;
end;
$$ language plpgsql security definer;

revoke execute on function place_order(text, text, text, text, text, jsonb) from public;
revoke execute on function place_order(text, text, text, text, text, jsonb) from anon;
grant execute on function place_order(text, text, text, text, text, jsonb) to authenticated;
