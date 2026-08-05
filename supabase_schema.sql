-- جداول متجر مشهد

-- تنظيف أي محاولة سابقة (آمن، ما في بيانات حقيقية لسا)
drop table if exists order_items cascade;
drop table if exists orders cascade;
drop table if exists products cascade;
drop table if exists reps cascade;
drop table if exists exchange_rates cascade;
drop table if exists metal_prices cascade;
drop table if exists categories cascade;
drop table if exists admin_users cascade;
drop table if exists metal_gram_prices cascade;

create table products (
  id text primary key,
  cat text not null,
  color text,
  name_ar text, name_en text, name_fr text,
  mat_ar text, mat_en text, mat_fr text,
  desc_ar text, desc_en text, desc_fr text,
  price numeric not null default 0,
  original_price numeric,
  cost numeric not null default 0,
  stock integer not null default 0,
  sizes text[] not null default '{}',
  images text[] not null default '{}',
  countries text[] not null default '{}',
  rep text,
  barcode text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  -- تسعير الأصناف "المباعة بالوزن" — sale_method='piece' (افتراضي) يبقي price كسعر ثابت يدوي كالمعتاد،
  -- 'weight' يجعل السعر الفعلي محسوبًا بالتطبيق من weight_grams × سعر الجرام المرتبط (metal_gram_prices)
  sale_method text not null default 'piece',
  weight_grams numeric,
  metal_type text,
  gold_karat integer,
  silver_type text
);

create table orders (
  id text primary key,
  order_date date not null default current_date,
  country text not null,
  payment text,
  customer_name text,
  customer_phone text,
  created_at timestamptz not null default now()
);

create table order_items (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  product_id text,
  qty integer not null,
  size text,
  price numeric not null default 0,
  cost numeric not null default 0,
  rep text
);

create table reps (
  id bigint generated always as identity primary key,
  name text unique not null
);

create table categories (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  created_at timestamptz not null default now()
);

create table exchange_rates (
  currency text primary key,
  rate numeric not null
);

create table metal_prices (
  id integer primary key default 1,
  gold_ounce numeric not null,
  silver_ounce numeric not null,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- حسابات المشرفين المحدودين (غير المشرف الأعلى) وصلاحياتهم — قائمة معرّفات أقسام لوحة الإدارة
-- المسموح فيها لهذا المشرف (مثلًا: '{reps,categories}'). الـ id هو نفسه uuid حساب Supabase Auth.
create table admin_users (
  id uuid primary key,
  email text unique not null,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- المصدر المركزي الوحيد لأسعار الذهب/الفضة بالجرام، تستخدمه الأصناف "المباعة بالوزن" —
-- تعديل أي سعر هون ينعكس تلقائيًا (بالتطبيق) على كل صنف مرتبط، مستقل عن مؤشر الأونصة في metal_prices
create table metal_gram_prices (
  id integer primary key default 1,
  gold_18 numeric not null default 0,
  gold_21 numeric not null default 0,
  gold_22 numeric not null default 0,
  silver_male numeric not null default 0,
  silver_female numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint single_row_gram check (id = 1)
);

-- تفعيل الحماية على مستوى الصفوف
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table reps enable row level security;
alter table exchange_rates enable row level security;
alter table metal_prices enable row level security;
alter table categories enable row level security;
alter table admin_users enable row level security;
alter table metal_gram_prices enable row level security;

-- المشرف الأعلى (صاحب المتجر) — الوحيد يلي يملك كل الصلاحيات دايمًا بغض النظر عن جدول admin_users
create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'rachad.fakouri@gmail.com';
$$;

-- تتحقق إذا كان المستخدم الحالي يملك صلاحية معينة: إما إنه المشرف الأعلى، أو مشرف محدود
-- عنده هالصلاحية بالذات ضمن admin_users.permissions
create or replace function has_permission(perm text)
returns boolean
language sql
stable
as $$
  select is_admin() or exists (
    select 1 from admin_users
    where email = coalesce(auth.jwt() ->> 'email', '')
      and perm = any(permissions)
  );
$$;

-- المنتجات: القراءة الكاملة (بما فيها التكلفة cost والأصناف المخفية) محصورة بالمشرفين المسجّلين دخولهم فقط.
-- الزوار/الموقع العام ما إلهم أي صلاحية قراءة مباشرة على الجدول نفسه — بيقروا فقط من العرض العام
-- "products_public" (بالأسفل) اللي ما فيه عمودي cost/rep وبيفلتر الأصناف المخفية تلقائيًا.
-- (2026-08-05: قبل هيك كانت products_public_read مفتوحة للجميع بدون قيود — أي حد يستدعي الـ API
-- مباشرة كان يقدر يشوف تكلفة كل صنف والأصناف المخفية، حتى لو الواجهة ما كانت تعرضها)
create policy "products_admin_read" on products for select
  to authenticated using (true);
create policy "products_admin_insert" on products for insert
  to authenticated with check (has_permission('add'));
create policy "products_admin_update" on products for update
  to authenticated using (has_permission('manage')) with check (has_permission('manage'));
create policy "products_admin_delete" on products for delete
  to authenticated using (has_permission('manage'));

-- عرض عام مقيّد الأعمدة والصفوف فوق جدول المنتجات — هذا اللي يقرأ منه الموقع العام (الزوار)،
-- بيستثني عمودي cost وrep وبيستبعد أي صنف hidden=true تلقائيًا
create or replace view products_public as
  select id, cat, color, name_ar, name_en, name_fr, mat_ar, mat_en, mat_fr,
         desc_ar, desc_en, desc_fr, price, original_price, stock, sizes, images,
         countries, barcode, views, sale_method, weight_grams, metal_type, gold_karat,
         silver_type, created_at
  from products
  where hidden = false;

grant select on products_public to anon, authenticated;

-- الطلبات: الإدخال يتم حصرًا عبر دالة place_order (security definer بتتحقق من السعر/التكلفة/المخزون
-- بنفسها، انظر supabase_schema_part2.sql) — ما في صلاحية إدخال مباشر على الجدولين لأي طرف،
-- حتى المشرف. قراءتها تحتاج صلاحية 'sales' أو 'reports'.
create policy "orders_admin_read" on orders for select
  to authenticated using (has_permission('sales') or has_permission('reports'));

create policy "order_items_admin_read" on order_items for select
  to authenticated using (has_permission('sales') or has_permission('reports'));

-- المندوبين: قراءة للجميع (تظهر بنموذج الإضافة)، تعديل يحتاج صلاحية 'reps'
create policy "reps_public_read" on reps for select using (true);
create policy "reps_admin_write" on reps for all
  to authenticated using (has_permission('reps')) with check (has_permission('reps'));

-- أسعار الصرف: تظهر للزوار بالواجهة، تعديلها يحتاج صلاحية 'rates'
create policy "rates_public_read" on exchange_rates for select using (true);
create policy "rates_admin_write" on exchange_rates for all
  to authenticated using (has_permission('rates')) with check (has_permission('rates'));

-- أسعار المعادن: تظهر للزوار بالواجهة، تعديلها يحتاج صلاحية 'metals'
create policy "metals_public_read" on metal_prices for select using (true);
create policy "metals_admin_write" on metal_prices for all
  to authenticated using (has_permission('metals')) with check (has_permission('metals'));

-- التصنيفات: قراءة للجميع (تظهر بفلتر المتجر ونموذج المنتج)، تعديلها يحتاج صلاحية 'categories'
create policy "categories_public_read" on categories for select using (true);
create policy "categories_admin_write" on categories for all
  to authenticated using (has_permission('categories')) with check (has_permission('categories'));

-- المشرفون: كل مشرف يشوف صف صلاحياته الخاص فقط (ليعرف أي أقسام تظهر إله)،
-- والمشرف الأعلى وحده يقدر يشوف/يضيف/يعدّل/يحذف القائمة كاملة
create policy "admin_users_self_or_super_read" on admin_users for select
  to authenticated using (is_admin() or email = coalesce(auth.jwt() ->> 'email', ''));
create policy "admin_users_super_write" on admin_users for all
  to authenticated using (is_admin()) with check (is_admin());

-- أسعار الذهب/الفضة بالجرام: تظهر للزوار (لعرض تفاصيل السعر بصفحة المنتج)، تعديلها يحتاج صلاحية 'metalRates'
create policy "metal_gram_prices_public_read" on metal_gram_prices for select using (true);
create policy "metal_gram_prices_admin_write" on metal_gram_prices for all
  to authenticated using (has_permission('metalRates')) with check (has_permission('metalRates'));

-- بيانات ابتدائية لأسعار الصرف والمعادن
insert into exchange_rates (currency, rate) values ('XAF', 605), ('XOF', 605);
insert into metal_prices (id, gold_ounce, silver_ounce) values (1, 2650, 30);
insert into reps (name) values ('محمود'), ('رشاد'), ('جميل');
insert into categories (id, name_ar, name_en, name_fr) values
  ('rings', 'خواتم', 'Rings', 'Bagues'),
  ('necklaces', 'قلائد', 'Necklaces', 'Colliers'),
  ('bracelets', 'أساور', 'Bracelets', 'Bracelets'),
  ('masabih', 'مسابح', 'Prayer Beads', 'Chapelets');
insert into metal_gram_prices (id) values (1);
