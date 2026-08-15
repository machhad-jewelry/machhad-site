-- إضافة: نظام قواعد التصنيفات (Category Rules) — كل تصنيف يحدد طريقة بيع منتجاته والحقول الإضافية
-- المطلوبة عند إضافة منتج ضمنه، بدل ما تكون هالإعدادات ثابتة بالكود. المرحلة الأولى فقط: قاعدة
-- البيانات + واجهة إدارة قواعد التصنيفات + نموذج إضافة/تعديل المنتج الديناميكي.
-- (لا تحذف أي جدول أو عمود قديم — هذه إضافة فوق الجداول الموجودة)

alter table categories add column if not exists image text;
alter table categories add column if not exists description_ar text;
alter table categories add column if not exists description_en text;
alter table categories add column if not exists description_fr text;
alter table categories add column if not exists sort_order integer not null default 0;
alter table categories add column if not exists active boolean not null default true;
alter table categories add column if not exists sale_type text not null default 'piece' check (sale_type in ('piece', 'weight'));
alter table categories add column if not exists requires_ring_size boolean not null default false;
alter table categories add column if not exists requires_bead_count boolean not null default false;
alter table categories add column if not exists requires_bead_size boolean not null default false;

alter table products add column if not exists bead_count integer;
alter table products add column if not exists bead_size text;

-- تعبئة القواعد الصحيحة للتصنيفات الموجودة أصلًا حتى ما يتغير أي سلوك حالي قبل ما يعدّل
-- صاحب المتجر عليها بنفسه لاحقًا من لوحة الإدارة
update categories set sale_type = 'piece', requires_ring_size = true where id in ('rings', 'women-s-silver-rings');
update categories set sale_type = 'piece', requires_bead_count = true, requires_bead_size = true where id = 'masabih';
update categories set sale_type = 'piece' where id in ('necklaces', 'bracelets');

-- ترتيب افتراضي منطقي للتصنيفات الموجودة (نفس الترتيب المعروض حاليًا بالواجهة)
update categories set sort_order = 10 where id = 'necklaces';
update categories set sort_order = 20 where id = 'bracelets';
update categories set sort_order = 30 where id = 'masabih';
update categories set sort_order = 40 where id = 'rings';
update categories set sort_order = 50 where id = 'women-s-silver-rings';
