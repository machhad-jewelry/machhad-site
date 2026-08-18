-- إضافة: نسخة مصغّرة (thumbnail) لكل صورة منتج، تُنشأ عند الرفع بجانب الصورة الأصلية كاملة الدقة
-- (لا تُحذف ولا تُستبدل الصورة الأصلية أبدًا) — تُستخدم بكل الأماكن اللي تعرض صورة صغيرة (بطاقات
-- المنتجات، الكاروسيلات، السلة، لوحة الإدارة)، بينما الصورة الأصلية تبقى فقط لصفحة تفاصيل المنتج
-- والـ Lightbox. المنتجات القديمة بدون thumbnails تعتمد تلقائيًا على الصورة الأصلية (fallback).
-- (لا تحذف أي جدول أو عمود قديم — هذه إضافة فوق الجداول الموجودة)

alter table products add column if not exists thumbnails jsonb;

-- عمود thumbnails الجديد لازم ينضاف لعرض products_public كمان (آخر القائمة، حسب قاعدة Postgres
-- بخصوص CREATE OR REPLACE VIEW) وإلا واجهة الزبائن (اللي تعتمد هالعرض) ما رح تشوفه أبدًا
create or replace view products_public as
  select id, cat, color, name_ar, name_en, name_fr, mat_ar, mat_en, mat_fr,
         desc_ar, desc_en, desc_fr, price, original_price, stock, sizes, images,
         countries, barcode, views, sale_method, weight_grams, metal_type, gold_karat,
         silver_type, created_at, bead_count, bead_size, featured, thumbnails
  from products
  where hidden = false;

grant select on products_public to anon, authenticated;
