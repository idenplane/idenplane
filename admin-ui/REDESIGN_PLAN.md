# Admin Console — Redesign Plan

> **الهدف:** تطبيق الديزاين الجديد (`new Design/Idenplane/`) على الـ admin console (`admin-ui`) **من غير ما نبوّظ أي شغل شغّال** (API, auth, routing, data).
> **آخر تحديث:** 27 مايو 2026 · **الحالة:** 📐 تخطيط

---

## 1. إيه هو الديزاين الجديد بالظبط

prototype مرئي مستقل (React UMD + Babel في المتصفح + inline styles + CSS variables)، مفيهوش API ولا routing ولا build. مكوّن من:

| الملف | إيه هو |
|-------|--------|
| `tokens.css` | الأساسات: ألوان (أسود + إيميرالد + إنديجو)، typography (Inter + JetBrains Mono)، spacing، radii، shadows، motion — كـ CSS variables (`--ip-*`) |
| `theme.css` | الطبقة الـ runtime: semantic vars (`--accent`, `--fg`, `--bg-elevated`...) + light/dark (midnight) |
| `primitives.jsx` | مكتبة 12 كومبوننت: Button, IconButton, Badge, Card, Input, Avatar, SectionHeader, Kbd, Segmented, Switch, EmptyState, Sparkline, Tooltip |
| `shell.jsx` | الـ layout (sidebar + header + nav) |
| `screens/*.jsx` | **9 شاشات تمثيلية بس**: login, dashboard, users, clients, roles, sessions, events, settings, misc |

## 2. ⚠️ الفجوة بين الـ prototype والواقع (ليه مينفعش ننسخه ونلزقه)

| | الـ prototype | الـ admin-ui الحقيقي |
|---|---|---|
| Stack | React 18 UMD + Babel + inline styles | React 19 + Vite + **TypeScript** + **Tailwind v4** + TanStack Query + react-router |
| Styling | inline styles + CSS vars | Tailwind utilities |
| الصفحات | **9 شاشات تمثيلية** | **80 ملف صفحة** عبر 20+ منطقة |
| الداتا | mock | API حقيقي + hooks + auth |

**الخلاصة:** ده **مش port لـ 9 شاشات** — ده **تبنّي design system وتطبيقه عبر تطبيق كامل**. أغلب الـ 80 صفحة مش مرسومة في الـ prototype، فهنستنتج النمط منه.

## 3. المبدأ الذهبي: نفصل الشكل عن المنطق

> القاعدة اللي بتحمينا من تبويظ الشغل: **مانلمسش طبقة الداتا أبداً** (الـ hooks، `src/api/*`، TanStack queries، auth، routing). نغيّر **الطبقة المرئية بس** (الـ JSX + الـ styling). كل صفحة بتحتفظ بالـ hooks/handlers بتاعتها بالظبط — إحنا بنعيد جلدها مرئياً.

## 4. الاستراتيجية: foundation → shell → pages (تدريجي، كل خطوة بتشحن تطبيق شغّال)

> **الـ shell + tokens + primitives لوحدهم بيدّوا ~70% من التحسين المرئي** — لأن كل صفحة بتتعرض جوا الإطار ده. وبعدها صقل الصفحات تدريجي وتقدر توقف في أي لحظة والتطبيق متناسق.

### Phase A — Foundation (إضافي، مش بيكسر حاجة)
- ندخّل `tokens.css` + `theme.css` في `admin-ui` (مدمجين في `src/index.css` / Tailwind v4 `@theme`)
- نضيف خطوط Inter + JetBrains Mono (self-hosted)
- **إضافي بالكامل** — بيعرّف vars جديدة، مفيش حاجة قديمة بتتكسر
- قرار: جسر الـ tokens — نمابها لـ Tailwind `@theme` (نستخدمها كـ utilities) ولا نستخدم الـ CSS vars مباشرة في الـ primitives

### Phase B — مكتبة الـ Primitives (`src/components/ui/`)
- نـ port الـ 12 كومبوننت لـ TS مكتوبين صح + typed + unit-tested
- دول حجارة البناء لكل شغل الصفحات بعد كده

### Phase C — الـ Shell / Layout (الإطار)
- نعيد تنسيق `components/Layout.tsx` (sidebar, header, realm switcher, nav) ليطابق `shell.jsx` — **مع الحفاظ على كل منطق الـ routing/realm/queries**
- ده لوحده بيغيّر إحساس التطبيق كله (كل صفحة بتقعد في الإطار الجديد)

### Phase D — الصفحات، بأولوية (PR لكل واحدة، نتحقق من كل واحدة)
بالترتيب (المرسوم في الـ prototype الأول لأنه مرجع جاهز):
1. **Login** (بسيطة، واجهة الديمو) · 2. **Dashboard** · 3. **Users** · 4. **Clients** · 5. **Roles / Sessions / Events** · 6. **Settings / Realms**
7. **الذيل الطويل** (auth-flows, groups, IdPs, SAML, SCIM, theme-builder, upgrade, registration, consent, NHI...) — نطبّق النمط/الـ primitives؛ مفيش mockup فنستنتج.

لكل صفحة: نحتفظ بالـ hooks/queries/handlers → نعيد الجلد بالـ primitives → نحدّث الـ tests اللي بتفحص markup (مش السلوك) → screenshot before/after → lint/typecheck/test أخضر.

### Phase E — صقل وتنظيف
حذف الستايلات القديمة الميتة، responsive، a11y (focus rings, contrast)، dark mode اختياري (الـ prototype فيه midnight)، QA مرئي نهائي.

## 5. قواعد الأمان (الطلب الصريح: منبوّظش الشغّال)

- branch من `dev`، **مش main مباشرة** (نفس الـ dev→main flow)
- **المنطق مايتلمسش** — الشكل بس. لو تغيير اضطرني ألمس hook/API → أقف وأعيد التفكير
- كل صفحة مستقلة + متحقّق منها قبل اللي بعدها. الترحيل الجزئي آمن (القديم + الجديد يتعايشوا) لأن الـ tokens إضافية والصفحات معزولة
- الـ tests تفضل خضرا؛ نحدّث بس الـ tests اللي بتفحص markup، **مش السلوك أبداً**
- بعد merge → الصورة تتبني تلقائي → نتحقق على الديمو
- screenshot diff لكل صفحة

## 6. ⏱️ الحجم والصراحة

- **Foundation + Primitives + Shell + الـ 8 صفحات المرسومة** = شغل جاد (أيام لـ ~أسبوع-أسبوعين)
- **الذيل الطويل (80 صفحة)** = الكتلة الأكبر — يتعمل تدريجي / عند الحاجة. التطبيق بيبان متناسق بعد الـ foundation+shell حتى لو صفحات الذيل لسه مش مصقولة (بترث الإطار + الـ typography)
- ده مجهود حقيقي متعدد الأيام/أسابيع، **بس تدريجي**: كل merge بيحسّن التطبيق ومفيش حاجة بتتكسر
- **توصية:** نبدأ بـ Foundation + Shell + Primitives + Login + Dashboard (أكبر مكسب مرئي ظاهر)، وبعدها نكرّر

## 7. قرارات مفتوحة

1. **جسر الـ tokens:** Tailwind `@theme` mapping ولا inline-style primitives ولا الاتنين؟ (توصية: hybrid — primitives بـ CSS-vars للأجزاء المعقّدة + Tailwind utilities مربوطة بالـ tokens للـ layout)
2. **Dark mode** دلوقتي ولا بعدين؟ (توصية: بعدين — نطابق الـ light الأول)
3. **الذيل الطويل**: نصقله كامل ولا نضمن إنه "يرث" الإطار ونصقل عالي الاستخدام بس؟ (توصية: يرث + أولوية)

---

*خطة حيّة — تتحدّث كل ما phase يخلص.*
