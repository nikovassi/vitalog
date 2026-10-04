import { getBiomarker } from '@vitalog/shared';

/**
 * Minimal FHIR R4 export (Bundle type "collection"). Not a full FHIR server – a portable,
 * standards-shaped copy of the user's data (GDPR Art. 20; EHDS readiness).
 * Mapping table: docs/04-DATA-MODEL.md.
 */

interface Input {
  user: { id: string; displayName: string; fullName: string | null; birthYear: number | null };
  reports: Array<{ id: string; title: string; collectedAt: string; laboratoryId: string | null; documentId: string | null; specialistId: string | null }>;
  results: Array<{
    id: string; reportId: string | null; biomarkerId: string | null; originalName: string; valueText: string; valueNumeric: number | null;
    valueComparator: string | null; unit: string | null; rangeLow: number | null; rangeHigh: number | null; rangeText: string | null; status: string;
    collectedAt: string; labCode: string | null; source: string; sourceDocumentId: string | null; sourcePage: number | null; edited: boolean; confirmedAt: string | null;
  }>;
  laboratories: Array<{ id: string; name: string; address: string | null; phone: string | null; website: string | null }>;
  specialists: Array<{ id: string; name: string; specialty: string; phone: string | null; email: string | null }>;
  documents: Array<{ id: string; name: string; mimeType: string; uploadedAt: string; sha256: string; category: string }>;
}

/** UCUM codes for our canonical spellings (only where the mapping is exact). */
const UCUM: Record<string, string> = {
  'mmol/L': 'mmol/L', 'µmol/L': 'umol/L', 'nmol/L': 'nmol/L', 'pmol/L': 'pmol/L', 'mg/dL': 'mg/dL', 'mg/L': 'mg/L',
  'g/L': 'g/L', 'g/dL': 'g/dL', 'U/L': 'U/L', 'IU/L': '[IU]/L', 'IU/mL': '[IU]/mL', 'mIU/L': 'm[IU]/L', 'µIU/mL': 'u[IU]/mL',
  '%': '%', 'fL': 'fL', 'pg': 'pg', 'L/L': 'L/L', '10⁹/L': '10*9/L', '10¹²/L': '10*12/L', 'mm/h': 'mm/h', 'ng/mL': 'ng/mL',
  'µg/L': 'ug/L', 'pg/mL': 'pg/mL', 'mL/min/1.73m²': 'mL/min/{1.73_m2}',
};

const INTERP: Record<string, { code: string; display: string } | undefined> = {
  in_range: { code: 'N', display: 'Normal' },
  above: { code: 'H', display: 'High' },
  below: { code: 'L', display: 'Low' },
};

const ref = (type: string, id: string) => ({ reference: `${type}/${id}` });

export function buildFhirBundle(d: Input) {
  const entries: unknown[] = [];
  const add = (resource: { resourceType: string; id: string }) => entries.push({ fullUrl: `urn:uuid:${resource.id}`, resource });

  add({
    resourceType: 'Patient',
    id: d.user.id,
    ...(d.user.fullName ? { name: [{ text: d.user.fullName }] } : { name: [{ text: d.user.displayName }] }),
    ...(d.user.birthYear ? { birthDate: String(d.user.birthYear) } : {}),
  });
  for (const l of d.laboratories) {
    add({
      resourceType: 'Organization', id: l.id, name: l.name,
      ...(l.address ? { address: [{ text: l.address }] } : {}),
      telecom: [l.phone && { system: 'phone', value: l.phone }, l.website && { system: 'url', value: l.website }].filter(Boolean),
    } as never);
  }
  for (const s of d.specialists) {
    add({
      resourceType: 'Practitioner', id: s.id, name: [{ text: s.name }],
      qualification: [{ code: { text: s.specialty } }],
      telecom: [s.phone && { system: 'phone', value: s.phone }, s.email && { system: 'email', value: s.email }].filter(Boolean),
    } as never);
  }
  for (const doc of d.documents) {
    add({
      resourceType: 'DocumentReference', id: doc.id, status: 'current',
      type: { text: doc.category }, date: doc.uploadedAt, subject: ref('Patient', d.user.id),
      content: [{ attachment: { contentType: doc.mimeType, title: doc.name, hash: Buffer.from(doc.sha256, 'hex').toString('base64') } }],
    } as never);
  }
  for (const r of d.results) {
    const bm = getBiomarker(r.biomarkerId);
    const coding = [
      ...(bm?.loinc ? [{ system: 'http://loinc.org', code: bm.loinc, display: bm.canonicalName }] : []),
      ...(r.labCode ? [{ system: 'urn:vitalog:lab-code', code: r.labCode }] : []),
    ];
    const ucum = r.unit ? UCUM[r.unit] : undefined;
    const quantity = (v: number) => ({ value: v, ...(r.unit ? { unit: r.unit } : {}), ...(ucum ? { system: 'http://unitsofmeasure.org', code: ucum } : {}) });
    const interp = INTERP[r.status];
    add({
      resourceType: 'Observation', id: r.id, status: r.edited ? 'amended' : 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { ...(coding.length ? { coding } : {}), text: r.originalName },
      subject: ref('Patient', d.user.id),
      effectiveDateTime: r.collectedAt,
      ...(r.valueNumeric !== null
        ? { valueQuantity: { ...quantity(r.valueNumeric), ...(r.valueComparator ? { comparator: r.valueComparator } : {}) } }
        : { valueString: r.valueText }),
      ...(r.rangeLow !== null || r.rangeHigh !== null || r.rangeText
        ? { referenceRange: [{ ...(r.rangeLow !== null ? { low: quantity(r.rangeLow) } : {}), ...(r.rangeHigh !== null ? { high: quantity(r.rangeHigh) } : {}), ...(r.rangeText ? { text: r.rangeText } : {}) }] }
        : {}),
      ...(interp ? { interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', ...interp }] }] } : {}),
    } as never);
    if (r.source === 'pdf' && r.sourceDocumentId) {
      add({
        resourceType: 'Provenance', id: `prov-${r.id}`, target: [ref('Observation', r.id)], recorded: r.confirmedAt ?? r.collectedAt,
        activity: { text: r.edited ? 'Extracted from PDF, corrected and confirmed by the user' : 'Extracted from PDF and confirmed by the user' },
        agent: [{ who: { display: 'Vitalog extraction pipeline' } }, { who: ref('Patient', d.user.id) }],
        entity: [{ role: 'source', what: ref('DocumentReference', r.sourceDocumentId), ...(r.sourcePage ? { extension: [{ url: 'urn:vitalog:page', valueInteger: r.sourcePage }] } : {}) }],
      } as never);
    }
  }
  for (const rep of d.reports) {
    add({
      resourceType: 'DiagnosticReport', id: rep.id, status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }],
      code: { text: rep.title }, subject: ref('Patient', d.user.id), effectiveDateTime: rep.collectedAt,
      ...(rep.laboratoryId ? { performer: [ref('Organization', rep.laboratoryId)] } : {}),
      // The linked specialist "follows" the result – not necessarily the interpreter, hence an extension
      ...(rep.specialistId ? { extension: [{ url: 'urn:vitalog:followed-by', valueReference: ref('Practitioner', rep.specialistId) }] } : {}),
      result: d.results.filter((r) => r.reportId === rep.id).map((r) => ref('Observation', r.id)),
    } as never);
  }
  return { resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), entry: entries };
}
