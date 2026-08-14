-- 2026-08-14: order_items_customer_read كانت سياسة على الجدول الأساسي بدون أي تقييد للأعمدة —
-- يعني أي زبون مسجّل دخوله يقدر يقرأ عمود cost (تكلفة الجملة) لطلباته مباشرة، تمامًا متل
-- ثغرة عمود cost بجدول products قبل إنشاء عرض products_public. نفس الحل هون: عرض مخصص
-- للزبائن يستثني cost وrep (بيانات إدارية داخلية)، وسحب صلاحية القراءة المباشرة عن الجدول
-- الأساسي للزبائن (تبقى فقط لأصحاب صلاحية 'sales'/'reports' عبر order_items_admin_read).

drop policy if exists "order_items_customer_read" on order_items;

create or replace view order_items_customer as
  select oi.id, oi.order_id, oi.product_id, oi.qty, oi.size, oi.price
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.customer_id = auth.uid();

grant select on order_items_customer to anon, authenticated;
