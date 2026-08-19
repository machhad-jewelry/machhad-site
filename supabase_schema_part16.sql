-- الانتقال من تخزين صور المنتجات base64 داخل قاعدة البيانات إلى Supabase Storage (تخزين حقيقي +
-- CDN). الهدف: أعلى جودة ممكنة (صورة أصلية بدون أي ضغط تُحفظ كطبقة ثالثة) مع أعلى سرعة ممكنة
-- (Storage تدعم caching بالمتصفح وCDN حقيقي، عكس أعمدة قاعدة البيانات اللي لازم تُنقل كاملة بكل طلب).
-- لا حذف لأي جدول أو عمود قديم — إضافة فوق البنية الحالية فقط.

-- طبقة ثالثة: الصورة الأصلية بدون أي تصغير إطلاقًا (للأرشفة/الاستخدام المستقبلي فقط — لا تُستخدم
-- بأي مسار يواجه الزبون، فما لها أي تكلفة على السرعة). تبقى بجدول products فقط، ولا تُضاف
-- لعرض products_public — الزبون ما إله أي داعي يشوفها أو يحمّلها إطلاقًا
alter table products add column if not exists originals text[];

-- إنشاء الـ bucket (عام القراءة — نفس واقع الصور اليوم بالضبط: صور تسويقية للمتجر، ما كان
-- عليها أي قيود وصول من الأساس)
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- قراءة عامة صريحة (كمان يخدمها الـ bucket العام مباشرة بدون فحص RLS، هاي إضافية للأمان فقط)
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read" on storage.objects for select
  using (bucket_id = 'product-images');

-- الكتابة تتبع نفس نمط صلاحيات جدول products بالضبط (has_permission، راجع supabase_schema.sql)
drop policy if exists "product_images_admin_insert" on storage.objects;
create policy "product_images_admin_insert" on storage.objects for insert
  to authenticated with check (bucket_id = 'product-images' and has_permission('add'));

drop policy if exists "product_images_admin_update" on storage.objects;
create policy "product_images_admin_update" on storage.objects for update
  to authenticated using (bucket_id = 'product-images' and has_permission('manage'))
  with check (bucket_id = 'product-images' and has_permission('manage'));

drop policy if exists "product_images_admin_delete" on storage.objects;
create policy "product_images_admin_delete" on storage.objects for delete
  to authenticated using (bucket_id = 'product-images' and has_permission('manage'));
