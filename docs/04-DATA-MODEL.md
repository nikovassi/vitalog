# 04 · Модел на данните

Източник на истината: [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts) (PostgreSQL, Drizzle) и [`packages/shared/src/models.ts`](../packages/shared/src/models.ts) (TypeScript модели).

## Релации

```
users 1─1 profiles
users 1─* sessions, auth_tokens, recovery_codes, consents (append-only)
users 1─* documents 1─* processing_jobs 1─* extraction_candidates   ← „чака преглед“
users 1─* lab_reports *─1 laboratories
                      *─1 specialists          (един специалист ↔ много изследвания)
                      1─1 documents (PDF източник)
lab_reports 1─* lab_results *─1 biomarkers 1─* biomarker_aliases
lab_results 1─* result_edits                    ← audit trail на корекциите
users 1─* favorites, notes, timeline_events, appointments, notifications, share_links, usage_counters
audit_logs                                      ← без FK: оцелява изтриване за срока на retention
```

- Един PDF → много резултати (`lab_results.report_id`, `source_document_id`, `source_page`).
- Един показател → много измервания (`lab_results.biomarker_id` или `custom_key` за непознати показатели).
- Всяка таблица с лични данни има `user_id` с `ON DELETE CASCADE` → изтриването на профила премахва всичко.

## Ключови решения

| Решение | Защо |
|---|---|
| **Кандидати ≠ резултати** | Извлечените стойности живеят в `extraction_candidates` до потвърждение. Само `POST /jobs/:id/confirm` създава `lab_results`. |
| **`value_text` + `value_numeric` + `value_comparator`** | Пазим стойността точно както е отпечатана („35,0“, „< 0,5“, „отрицателен“). Числото е производно. |
| **Референтният диапазон е в `lab_results`** (`range_low/high/text/source`) | Диапазонът принадлежи на конкретното измерване (лаборатория, метод, дата) – като FHIR `Observation.referenceRange`. Отделна таблица `reference_ranges` би подсказала „универсален“ диапазон, какъвто не използваме. `range_source` ∈ `laboratory`/`user`. |
| **Каталогът е в кода, огледален в БД** | `packages/shared/src/biomarkers.ts` се синхронизира в `biomarkers` + `biomarker_aliases` при миграция. **Не съдържа референтни стойности.** |
| **Конверсиите не презаписват** | `displayValue` се изчислява при четене чрез изрични правила; оригиналът никога не се променя. |
| **Confidence е вътрешен** | `extraction_confidence` се пази за проследимост, не се показва числово и не излиза в експорта. |
| **Provenance** | `source` (pdf/manual/import/device), `source_document_id`, `source_page`, `extracted_at`, `confirmed_at`, `edited`, `result_edits` (кой, кога, какво, оригинал → нова стойност). |

## Biomarker модел

`id · canonicalName · bgName · aliases[] · category · unit · supportedUnits[] · conversionRules[] · loinc · description · referenceRange (винаги null) · source`

- Съвпадение само по **точен нормализиран alias** (регистър, интервали, пунктуация, µ/μ). Без fuzzy съвпадения.
- Ако единицата не е сред `supportedUnits` (напр. „Neutrophils 3,6 10⁹/L“ спрямо „Неутрофили %“) – **не се свързва**, остава непознат показател.
- Конверсии само по молекулна маса/дефиниция: глюкоза, холестерол (общ/LDL/HDL), триглицериди, креатинин, пикочна киселина, хемоглобин g/dL→g/L, хематокрит L/L↔%. Идентичности: µIU/mL = mIU/L = mU/L; ng/mL = µg/L; U/L = IU/L.
- Нарочно **без** конверсия: HbA1c %↔mmol/mol (различни LOINC), витамин D, пролактин, B12, билирубин, урея/BUN – водят се отделно.

## FHIR R4 съответствие (`GET /api/export/fhir`)

| Vitalog | FHIR | Бележки |
|---|---|---|
| User/Profile | `Patient` | само име (ако е въведено) и година |
| LabReport | `DiagnosticReport` | category=LAB, effectiveDateTime, performer→Organization, result[]→Observation; свързаният специалист е extension `followed-by` (не е непременно интерпретатор) |
| LabResult | `Observation` | code: LOINC (ако е проверен) + лабораторен код + originalText; valueQuantity с UCUM; comparator; referenceRange; interpretation H/L/N; status `amended` при корекция |
| Biomarker | CodeSystem/ConceptMap концепция | aliases → ConceptMap към LOINC в бъдеще |
| Laboratory | `Organization` | |
| Specialist | `Practitioner` | |
| Document | `DocumentReference` | hash, contentType, title |
| Извличане + потвърждение | `Provenance` | target=Observation, entity=DocumentReference, agent=pipeline + пациент |

Бъдещ импорт (Apple Health, Health Connect, FHIR, уреди): нов `source` + `source_label`; моделът не изисква промени.
