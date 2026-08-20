-- 2026-08-20: نظام التقييمات (Ratings & Reviews) — تقييم موثّق (verified purchase) فقط:
-- الزبون لازم يكون عنده طلب سابق بحالة 'delivered' يحتوي هالمنتج بالضبط حتى يقدر يقيّمه، تقييم واحد لكل زبون لكل منتج.

create table if not exists reviews (
  id bigint generated always as identity primary key,
  product_id text not null references products(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  customer_name text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (product_id, customer_id)
);

alter table reviews enable row level security;

-- دالة تحقّق "هل هالزبون استلم فعليًا هالمنتج بطلب سابق؟" — لازم security definer لأنها تقرأ
-- orders/order_items، والجدولان مقفولان بالكامل أمام authenticated (لا سياسة select عامة عليهما
-- منذ إصلاح تسريب cost/rep بتاريخ 2026-08-14)؛ نفس نمط is_admin()/has_permission() المعتمد بالمشروع.
create or replace function has_delivered_order(p_product_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from orders o
    join order_items oi on oi.order_id = o.id
    where o.customer_id = auth.uid()
      and o.status = 'delivered'
      and oi.product_id = p_product_id
  );
$$;

revoke all on function has_delivered_order(text) from public;
grant execute on function has_delivered_order(text) to authenticated;

-- الزبون يقدر يشوف صفوف تقييماته هو فقط من الجدول الأساسي (يُستخدم بالواجهة لمعرفة "هل قيّمت هالمنتج من قبل؟")
drop policy if exists "reviews_own_select" on reviews;
create policy "reviews_own_select" on reviews for select
  to authenticated
  using (customer_id = auth.uid());

-- إضافة تقييم: فقط لصاحبه (customer_id = auth.uid())، وفقط لمنتج استلمه فعليًا
drop policy if exists "reviews_insert_verified" on reviews;
create policy "reviews_insert_verified" on reviews for insert
  to authenticated
  with check (
    customer_id = auth.uid()
    and has_delivered_order(product_id)
  );

-- حذف تقييم: المشرف الأساسي فقط (إشراف/إزالة تقييم مسيء) — لا تعديل، فقط حذف
drop policy if exists "reviews_admin_delete" on reviews;
create policy "reviews_admin_delete" on reviews for delete
  to authenticated
  using (is_admin());

grant select, insert on reviews to authenticated;

-- عرض عام للقراءة (بدون customer_id) — يُقرأ من الجميع (زوار + زبائن)، بنفس نمط products_public
create or replace view reviews_public as
  select id, product_id, customer_name, rating, comment, created_at
  from reviews;

grant select on reviews_public to anon, authenticated;
