-- إضافة: تتبّع سلوك الزوار/الزبائن (مشاهدات المنتجات) + محرك توصيات داخلي (بدون أي خدمة AI خارجية)
-- + منتجات مميزة (Featured) يحددها صاحب المتجر يدويًا. المرحلة الأولى فقط: قاعدة البيانات + دوال
-- الحساب. لا تُحذف أي جدول أو عمود أو دالة قديمة — هذه إضافة فوق البنية الحالية فقط.
-- (لا تحذف أي جدول أو عمود قديم — هذه إضافة فوق الجداول الموجودة)

alter table products add column if not exists featured boolean not null default false;

-- سجل أحداث المشاهدة: صف واحد لكل مشاهدة منتج، يُستخدم لحساب "الأكثر رواجًا الآن" و"مُوصى به لك"
-- و"شوهد مؤخرًا". يبقى العدّاد البسيط الحالي products.views كما هو تمامًا (لا يُحذف ولا يُستبدل) —
-- هذا الجدول إضافي فقط لدعم التخصيص الحقيقي الذي لا يقدر العدّاد البسيط تغطيته.
create table if not exists product_view_events (
  id bigint generated always as identity primary key,
  customer_id uuid references auth.users(id) on delete cascade,
  session_id text,
  product_id text references products(id) on delete cascade,
  category_id text,
  viewed_at timestamptz not null default now()
);
create index if not exists idx_pve_customer on product_view_events(customer_id, viewed_at desc);
create index if not exists idx_pve_session on product_view_events(session_id, viewed_at desc);
create index if not exists idx_pve_recency_cat on product_view_events(viewed_at, category_id);
create index if not exists idx_pve_product on product_view_events(product_id);
alter table product_view_events enable row level security;
-- لا توجد أي policy عن قصد — هذا الجدول غير قابل للوصول مباشرة من العميل (anon أو authenticated)،
-- كل قراءة/كتابة تمر حصرًا عبر دوال SECURITY DEFINER أدناه (نفس نمط place_order/increment_product_view)

-- عمود featured الجديد لازم ينضاف لعرض products_public كمان (آخر القائمة، حسب قاعدة Postgres
-- بخصوص CREATE OR REPLACE VIEW) وإلا واجهة الزبائن (اللي تعتمد هالعرض) ما رح تشوفه أبدًا
create or replace view products_public as
  select id, cat, color, name_ar, name_en, name_fr, mat_ar, mat_en, mat_fr,
         desc_ar, desc_en, desc_fr, price, original_price, stock, sizes, images,
         countries, barcode, views, sale_method, weight_grams, metal_type, gold_karat,
         silver_type, created_at, bead_count, bead_size, featured
  from products
  where hidden = false;

grant select on products_public to anon, authenticated;

-- تسجيل مشاهدة منتج: تُستدعى إضافة إلى (وليس بدل) increment_product_view الحالية. هوية الزبون
-- المسجّل تُشتق من auth.uid() على السيرفر (غير موثوقة من العميل)، ومعرّف الزيارة المجهولة
-- (session_id) قيمة محلية عشوائية من المتصفح لا تحمل أي هوية حقيقية، تُستخدم فقط للتجميع.
create or replace function track_product_view(p_product_id text, p_session_id text default null)
returns void as $$
declare
  v_cat text;
begin
  select cat into v_cat from products where id = p_product_id;
  if v_cat is null then
    return;
  end if;
  insert into product_view_events (customer_id, session_id, product_id, category_id)
  values (auth.uid(), p_session_id, p_product_id, v_cat);
end;
$$ language plpgsql security definer;

grant execute on function track_product_view(text, text) to anon, authenticated;

-- منتجات "مُوصى بها لك": تُحسب من تصنيفات المنتجات التي شاهدها هذا الزائر بالذات (بحسب auth.uid()
-- إذا مسجّل دخول، أو session_id إذا زائر مجهول)، بترجيح يتناقص مع الزمن (decay) حتى ما تطغى
-- اهتمامات قديمة على الاهتمام الحالي. HALF_LIFE_DAYS ثابت هنا فقط لسهولة التعديل لاحقًا بدون
-- الحاجة لتغيير منطق الحساب. ترجع فارغة إذا ما في أي سجل مشاهدة لهذا الزائر — الواجهة الأمامية
-- عندها تعرض الأكثر رواجًا/الأحدث بدلًا منها (وليس نتيجة عشوائية).
create or replace function get_recommended_products(p_session_id text default null, p_limit int default 10)
returns setof products_public as $$
declare
  v_customer_id uuid := auth.uid();
  v_half_life_days numeric := 14;
begin
  if v_customer_id is null and p_session_id is null then
    return;
  end if;

  return query
  with cat_scores as (
    select category_id,
           sum(exp(-ln(2) * extract(epoch from (now() - viewed_at)) / (v_half_life_days * 86400))) as score
    from product_view_events
    where category_id is not null
      and ((v_customer_id is not null and customer_id = v_customer_id)
           or (v_customer_id is null and session_id = p_session_id))
    group by category_id
    order by score desc
    limit 2
  )
  select p.*
  from products_public p
  join cat_scores cs on p.cat = cs.category_id
  where p.stock > 0
  order by cs.score desc, p.views desc
  limit p_limit;
end;
$$ language plpgsql security definer;

grant execute on function get_recommended_products(text, int) to anon, authenticated;

-- منتجات "رائجة الآن": مقارنة عدد المشاهدات بآخر 7 أيام مقابل الأسبوع الذي قبله — منتج بزيادة حقيقية
-- بالإقبال، مش مجرد ترتيب صفوف عشوائي. لا تحتاج هوية زائر (عامة لكل الموقع).
create or replace function get_trending_products(p_limit int default 10)
returns setof products_public as $$
begin
  return query
  with recent as (
    select product_id,
           count(*) filter (where viewed_at >= now() - interval '7 days') as recent_count,
           count(*) filter (where viewed_at >= now() - interval '14 days'
                               and viewed_at < now() - interval '7 days') as prior_count
    from product_view_events
    where viewed_at >= now() - interval '14 days'
    group by product_id
  )
  select p.*
  from products_public p
  join recent r on r.product_id = p.id
  where p.stock > 0 and r.recent_count > 0
  order by (r.recent_count - r.prior_count) desc, r.recent_count desc
  limit p_limit;
end;
$$ language plpgsql security definer;

grant execute on function get_trending_products(int) to anon, authenticated;

-- منتجات "شوهدت مؤخرًا": لنفس الزائر (auth.uid() أو session_id)، آخر مشاهدة لكل منتج مختلف.
create or replace function get_recently_viewed(p_session_id text default null, p_limit int default 10)
returns setof products_public as $$
declare
  v_customer_id uuid := auth.uid();
begin
  if v_customer_id is null and p_session_id is null then
    return;
  end if;

  return query
  select p.*
  from products_public p
  join (
    select product_id, max(viewed_at) as last_viewed
    from product_view_events
    where (v_customer_id is not null and customer_id = v_customer_id)
       or (v_customer_id is null and session_id = p_session_id)
    group by product_id
    order by max(viewed_at) desc
    limit p_limit
  ) rv on rv.product_id = p.id
  order by rv.last_viewed desc;
end;
$$ language plpgsql security definer;

grant execute on function get_recently_viewed(text, int) to anon, authenticated;
