-- إضافة: حسابات الزبائن (تسجيل دخول، متابعة الطلبيات، سجل الطلبيات القديمة) + حالة تتبع الطلب
-- (لا تحذف أي جدول قديم — هذه إضافة فوق الجداول الموجودة)

-- تحقق أدق من "هل المستخدم الحالي مشرف من أي نوع" (مش بالضرورة عنده صلاحية محددة) — لازم هلق
-- بعد ما صار في حسابات زبائن حقيقية، لأن أي جلسة "authenticated" ما عادت تعني مشرف تلقائيًا
create or replace function is_any_admin()
returns boolean
language sql
stable
as $$
  select is_admin() or exists (
    select 1 from admin_users where email = coalesce(auth.jwt() ->> 'email', '')
  );
$$;

-- تضييق قراءة جدول المنتجات الكامل (يشمل عمود cost) لتصير حصرًا للمشرفين، مش لأي جلسة "authenticated" —
-- قبل حسابات الزبائن كانت فرضية "authenticated = مشرف" صحيحة دايمًا، هلق ما عادت
drop policy if exists "products_admin_read" on products;
create policy "products_admin_read" on products for select
  to authenticated using (is_any_admin());

-- جدول الزبائن: صف واحد لكل حساب Supabase Auth، يخزن بيانات التواصل المستخدمة لتعبئة الطلب تلقائيًا
create table if not exists customers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

alter table customers enable row level security;

drop policy if exists "customers_self_read_write" on customers;
create policy "customers_self_read_write" on customers for all
  to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "customers_admin_read" on customers;
create policy "customers_admin_read" on customers for select
  to authenticated using (has_permission('customers'));

-- ربط الطلب بحساب الزبون (اختياري — الطلبات القديمة قبل هالميزة تبقى بدون ربط) + حالة تتبع الطلب
alter table orders add column if not exists customer_id uuid references auth.users(id);
alter table orders add column if not exists status text not null default 'pending';
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'processing', 'shipped', 'delivered', 'cancelled'));

-- الزبون المسجّل دخوله يشوف طلباته الخاصة فقط (سجل الطلبيات + متابعة الحالة)
drop policy if exists "orders_customer_read" on orders;
create policy "orders_customer_read" on orders for select
  to authenticated using (customer_id = auth.uid());

drop policy if exists "order_items_customer_read" on order_items;
create policy "order_items_customer_read" on order_items for select
  to authenticated using (
    exists (select 1 from orders where orders.id = order_items.order_id and orders.customer_id = auth.uid())
  );

-- المشرف صاحب صلاحية 'sales' يقدر يعدّل حالة الطلب (تتبع الشحن للزبون)
drop policy if exists "orders_admin_update_status" on orders;
create policy "orders_admin_update_status" on orders for update
  to authenticated using (has_permission('sales')) with check (has_permission('sales'));

-- ربط الطلبات القديمة (قبل إنشاء الحساب) تلقائيًا برقم الهاتف — تُستدعى مرة وحدة فور التسجيل.
-- آمنة رغم إنها security definer لأنها بس بتربط صفوف مش مربوطة أصلًا (customer_id is null) بالمستخدم
-- الحالي نفسه (auth.uid())، ما فيها أي مجال إنها تربط أو تعدّل طلب حدا تاني
create or replace function link_past_orders_by_phone(p_phone text)
returns void as $$
begin
  update orders set customer_id = auth.uid()
  where customer_phone = p_phone and customer_id is null;
end;
$$ language plpgsql security definer;

grant execute on function link_past_orders_by_phone(text) to authenticated;

-- place_order: تسجيل هوية الزبون من الجلسة نفسها (auth.uid())، مش من أي قيمة يرسلها المتصفح.
-- تبقى الدالة قابلة للاستدعاء من anon مؤقتًا (customer_id بيصير null بهالحالة، تمامًا متل الطلبات
-- القديمة) لحد ما تُنشر الواجهة الجديدة اللي بتفرض تسجيل الدخول، وبعدها تُسحب صلاحية anon بخطوة
-- منفصلة لاحقًا — تفاديًا لانقطاع أي طلب شراء حي أثناء نشر هالتحديث
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

  insert into orders (id, country, payment, customer_name, customer_phone, customer_id)
  values (p_id, p_country, p_payment, p_customer_name, p_customer_phone, auth.uid());

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
