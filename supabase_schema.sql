-- جداول متجر مشهد

-- تنظيف أي محاولة سابقة (آمن، ما في بيانات حقيقية لسا)
drop table if exists order_items cascade;
drop table if exists orders cascade;
drop table if exists products cascade;
drop table if exists reps cascade;
drop table if exists exchange_rates cascade;
drop table if exists metal_prices cascade;

create table products (
  id text primary key,
  cat text not null,
  color text,
  name_ar text, name_en text, name_fr text,
  mat_ar text, mat_en text, mat_fr text,
  desc_ar text, desc_en text, desc_fr text,
  price numeric not null default 0,
  cost numeric not null default 0,
  stock integer not null default 0,
  sizes text[] not null default '{}',
  images text[] not null default '{}',
  countries text[] not null default '{}',
  rep text,
  barcode text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
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

-- تفعيل الحماية على مستوى الصفوف
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table reps enable row level security;
alter table exchange_rates enable row level security;
alter table metal_prices enable row level security;

-- المنتجات: قراءة للجميع، تعديل للإدارة المسجّلة دخول فقط
create policy "products_public_read" on products for select using (true);
create policy "products_admin_write" on products for all
  to authenticated using (true) with check (true);

-- الطلبات: أي زائر يقدر ينشئ طلب، بس بس الإدارة تقدر تشوفهم
create policy "orders_public_insert" on orders for insert
  to anon, authenticated with check (true);
create policy "orders_admin_read" on orders for select
  to authenticated using (true);

create policy "order_items_public_insert" on order_items for insert
  to anon, authenticated with check (true);
create policy "order_items_admin_read" on order_items for select
  to authenticated using (true);

-- المندوبين: قراءة للجميع (تظهر بنموذج الإضافة)، تعديل للإدارة فقط
create policy "reps_public_read" on reps for select using (true);
create policy "reps_admin_write" on reps for all
  to authenticated using (true) with check (true);

-- أسعار الصرف والمعادن: تظهر للزوار بالواجهة، تعديل للإدارة فقط
create policy "rates_public_read" on exchange_rates for select using (true);
create policy "rates_admin_write" on exchange_rates for all
  to authenticated using (true) with check (true);

create policy "metals_public_read" on metal_prices for select using (true);
create policy "metals_admin_write" on metal_prices for all
  to authenticated using (true) with check (true);

-- بيانات ابتدائية لأسعار الصرف والمعادن
insert into exchange_rates (currency, rate) values ('XAF', 605), ('XOF', 605);
insert into metal_prices (id, gold_ounce, silver_ounce) values (1, 2650, 30);
insert into reps (name) values ('محمود'), ('رشاد'), ('جميل');
