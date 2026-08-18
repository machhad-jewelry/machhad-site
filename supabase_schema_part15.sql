-- إصلاح: دوال التخصيص (رائج الآن / مُوصى به لك / شوهد مؤخرًا) كانت ترجع "500" على الموقع
-- المباشر بسبب نفس سبب العطل السابق بالضبط: كل دالة تعمل select p.* from products_public،
-- والعرض ده لسه بيحتوي عمود images (الصور الأصلية base64 الثقيلة) لأنه لسه ما اتلمسش وقت
-- إصلاح جلب المنتجات الرئيسي (اللي استخدم LEAN_PRODUCT_COLUMNS على مستوى الواجهة فقط،
-- مش على مستوى قاعدة البيانات) — فالنتيجة نفس timeout (57014) بس بمكان تاني.
-- الحل: عرض "خفيف" مطابق لنفس القائمة اللي بتستخدمها الواجهة، بدون عمود images، وتحويل
-- الثلاث دوال لتستخدمه بدل products_public. لا حذف لأي جدول/عمود/دالة قديمة.

create or replace view products_public_lean as
  select id, cat, color, name_ar, name_en, name_fr, mat_ar, mat_en, mat_fr,
         desc_ar, desc_en, desc_fr, price, original_price, stock, sizes,
         countries, barcode, views, sale_method, weight_grams, metal_type, gold_karat,
         silver_type, created_at, bead_count, bead_size, featured, thumbnails
  from products
  where hidden = false;

grant select on products_public_lean to anon, authenticated;

-- لازم drop قبل create لأن نوع الإرجاع (return type) تغيّر — Postgres ما بيسمح بتغييره
-- عبر create or replace function لوحدها
drop function if exists get_recommended_products(text, int);
drop function if exists get_trending_products(int);
drop function if exists get_recently_viewed(text, int);

create function get_recommended_products(p_session_id text default null, p_limit int default 10)
returns setof products_public_lean as $$
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
  from products_public_lean p
  join cat_scores cs on p.cat = cs.category_id
  where p.stock > 0
  order by cs.score desc, p.views desc
  limit p_limit;
end;
$$ language plpgsql security definer;

grant execute on function get_recommended_products(text, int) to anon, authenticated;

create function get_trending_products(p_limit int default 10)
returns setof products_public_lean as $$
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
  from products_public_lean p
  join recent r on r.product_id = p.id
  where p.stock > 0 and r.recent_count > 0
  order by (r.recent_count - r.prior_count) desc, r.recent_count desc
  limit p_limit;
end;
$$ language plpgsql security definer;

grant execute on function get_trending_products(int) to anon, authenticated;

create function get_recently_viewed(p_session_id text default null, p_limit int default 10)
returns setof products_public_lean as $$
declare
  v_customer_id uuid := auth.uid();
begin
  if v_customer_id is null and p_session_id is null then
    return;
  end if;

  return query
  select p.*
  from products_public_lean p
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
