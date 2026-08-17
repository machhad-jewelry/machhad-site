-- إصلاح أمني (من تقرير الفحص الشامل، بند D1): place_order ما كان عليه أي حد أدنى زمني بين
-- طلبين متتاليين لنفس الزبون. بما إن المخزون يُخصَم فور إنشاء الطلب (عبر trigger موجود، مش عند
-- تأكيد الدفع — المتجر يعتمد الدفع عند الاستلام/تحويل، مش بوابة دفع فورية)، كان بإمكان أي زبون
-- مسجّل دخوله يستدعي place_order بشكل متكرر وسريع (سكربت آلي) لتصفير مخزون أي منتج بدون ما يشتري
-- فعليًا. الحل الأدنى الآمن: منع أي زبون من إنشاء طلب جديد قبل مرور 30 ثانية على آخر طلب له —
-- يحد بشكل كبير من سرعة أي إساءة استخدام آلية بدون ما يغيّر سلوك الشراء الطبيعي للزبون الحقيقي
-- (نادرًا ما يحتاج زبون حقيقي يفتح طلبين منفصلين خلال أقل من نصف دقيقة).
-- (لا تحذف أي جدول أو عمود قديم — هذه إضافة فوق الجداول الموجودة)

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
  v_last_order_at timestamptz;
begin
  select max(created_at) into v_last_order_at from orders where customer_id = auth.uid();
  if v_last_order_at is not null and now() - v_last_order_at < interval '30 seconds' then
    raise exception 'rate_limited: please wait a moment before placing another order';
  end if;

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
