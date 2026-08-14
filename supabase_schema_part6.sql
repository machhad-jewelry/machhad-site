-- 2026-08-14: تعطيل الربط التلقائي للطلبات القديمة برقم الهاتف (مؤقتًا) —
-- كانت link_past_orders_by_phone بتربط أي طلب قديم برقم هاتف يكتبه أي مستخدم بنفسه عند
-- التسجيل، بدون أي تحقق فعلي إنه صاحب هالرقم — يعني حدا يعرف رقم هاتف زبون قديم كان يقدر
-- يسجّل حساب فيه ويوصل تلقائيًا لكل طلبات ذاك الزبون (الأصناف، الأسعار، العنوان).
-- الواجهة عادت ما بتستدعيها، وهون منسحب صلاحية التنفيذ من anon/PUBLIC/authenticated
-- بالكامل حتى ما يقدر حدا يستدعيها يدويًا (من console المتصفح مثلًا) كمان — الدالة نفسها
-- تبقى موجودة بقاعدة البيانات لاستخدام يدوي مستقبلي من صاحب المتجر (عبر SQL مباشر) بعد
-- تحقق حقيقي من صاحب رقم الهاتف، لو احتاج الأمر.

revoke execute on function link_past_orders_by_phone(text) from public;
revoke execute on function link_past_orders_by_phone(text) from anon;
revoke execute on function link_past_orders_by_phone(text) from authenticated;
