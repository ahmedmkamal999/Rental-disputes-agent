/**
 * Key legal references from Ajman Real Estate Tenancy Law (Amiri Decree No. 2 of 2017)
 * Keep concise to embed in agent instructions.
 * Sources: Law/Rental Law (en).json and Law/Rental Law (ar).json
 */

export const LAW_REFERENCE_EN = `
Ajman Real Estate Tenancy Law (Amiri Decree No. 2 of 2017) - Key Articles:
- Art. 3(1)-(2): Scope and exclusions of the law (Ajman properties and excluded categories).
- Art. 4(1): Lease must be written on Municipality form and attested within 21 days; renewals require attestation.
- Art. 4(4): If lease not renewed or lost, an official Municipality certificate may be issued.
- Art. 5(1): Lease term must be specified; if not, deemed one year.
- Art. 6(6): Rent increase only after 3 years from lease start or last increase (whichever later).
- Art. 6(7): Rent increase requires written notice at least 2 months before lease end and cap of 20%.
- Art. 7(4): Lessor may not cut services or force eviction via utilities.
- Art. 8(1)-(2): Lessor must perform necessary maintenance; repair defects materially affecting use.
- Art. 9(4)-(6): Subleasing requires written approval; tenant pays utilities unless contract says otherwise.
- Art. 12(1): Eviction only for listed reasons (nonpayment, breach after notice, damage, vacancy 4 months, unlawful use, etc.).
- Art. 17(1): Claim must include attested lease copy or official Municipality certificate.
`;

export const LAW_REFERENCE_AR = `
قانون إيجار العقارات في إمارة عجمان (المرسوم الأميري رقم 2 لسنة 2017) - مواد أساسية:
- المادة 3(1)-(2): نطاق التطبيق والاستثناءات.
- المادة 4(1): عقد الإيجار يجب أن يكون مكتوباً على نموذج البلدية ومصدقاً خلال 21 يوماً؛ وتجديد العقد يتطلب تصديقاً.
- المادة 4(4): عند عدم التجديد أو فقدان العقد يجوز إصدار شهادة رسمية من البلدية.
- المادة 5(1): يجب تحديد مدة الإيجار؛ وإذا لم تحدد فمدتها سنة واحدة.
- المادة 6(6): لا يجوز زيادة الإيجار إلا بعد مرور 3 سنوات من بدء العقد أو آخر زيادة (أي التاريخين أسبق).
- المادة 6(7): زيادة الإيجار تتطلب إخطاراً خطياً قبل شهرين على الأقل وألا تتجاوز 20%.
- المادة 7(4): لا يجوز للمؤجر قطع الخدمات أو إجبار المستأجر على الإخلاء عبر الخدمات.
- المادة 8(1)-(2): التزام المؤجر بأعمال الصيانة والإصلاحات الضرورية.
- المادة 9(4)-(6): التأجير من الباطن يتطلب موافقة خطية؛ المستأجر يتحمل الخدمات ما لم ينص العقد خلاف ذلك.
- المادة 12(1): الإخلاء لا يجوز إلا للأسباب المحددة (عدم السداد، إخلال بعد إنذار، ضرر جسيم، ترك 4 أشهر، استعمال غير مشروع، إلخ).
- المادة 17(1): يجب إرفاق عقد إيجار مصدق أو شهادة رسمية من البلدية.
`;

export const CLARIFY_QUESTIONS_EN = `
Clarification prompts (ask only if missing and needed):
- Scope: Is the property in Ajman and not excluded (e.g., hotel suites, agricultural land, labor housing)? (Art. 3)
- Lease validity: Is the lease attested by the Municipality? If not, do you have an official Municipality certificate? (Art. 4(1), 4(4), 17(1))
- Lease term: What is the agreed lease term? If not specified, treat as one year. (Art. 5(1))
- Rent increase dispute: When did the lease start? When was the last increase? What is the requested increase %? Was a written notice given at least 2 months before lease end? (Art. 6(6), 6(7))
- Maintenance or habitability: What defect or maintenance issue exists? When reported? Any evidence? (Art. 8(1)-(2))
- Utility/service cut-off: Which services were cut and when? (Art. 7(4))
- Subleasing: Was there written approval from the lessor? (Art. 9(4))
- Eviction dispute: What exact eviction reason is claimed? Was written notice given (timing)? (Art. 12(1))
`;

export const CLARIFY_QUESTIONS_AR = `
أسئلة توضيحية (اسأل فقط إذا كانت ناقصة وضرورية):
- النطاق: هل العقار داخل عجمان وليس من الفئات المستثناة (فنادق، أراضٍ زراعية، سكن عمال مجاني، إلخ)؟ (المادة 3)
- صحة العقد: هل عقد الإيجار مُصدق من البلدية؟ إذا لم يكن، هل لديك شهادة رسمية من البلدية؟ (المادتان 4(1) و4(4) والمادة 17(1))
- مدة الإيجار: ما المدة المتفق عليها؟ إذا لم تُحدد فهي سنة واحدة. (المادة 5(1))
- نزاع زيادة الإيجار: متى بدأ العقد؟ ومتى كانت آخر زيادة؟ وما نسبة الزيادة المطلوبة؟ وهل تم إرسال إخطار خطي قبل شهرين على الأقل من نهاية العقد؟ (المادتان 6(6) و6(7))
- نزاع الصيانة: ما العيب أو مشكلة الصيانة؟ ومتى تم الإبلاغ؟ وهل توجد أدلة؟ (المادة 8(1)-(2))
- قطع الخدمات: ما الخدمات التي تم قطعها ومتى؟ (المادة 7(4))
- التأجير من الباطن: هل هناك موافقة خطية من المؤجر؟ (المادة 9(4))
- نزاع الإخلاء: ما سبب الإخلاء المحدد؟ وهل تم إرسال إخطار خطي وفي أي توقيت؟ (المادة 12(1))
`;
