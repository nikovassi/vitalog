import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BIOMARKERS, normalizeAliasKey } from '@vitalog/shared';
import { sql } from 'drizzle-orm';
import { db, sqlClient } from './client';
import { biomarkerAliases, biomarkers } from './schema';

const dir = path.dirname(fileURLToPath(import.meta.url));
// src/db → ../../drizzle ; dist → ../drizzle
const folder = [path.resolve(dir, '../../drizzle'), path.resolve(dir, '../drizzle')].find((p) => existsSync(p))!;

/** Mirror the code catalog into the DB (upsert) so results can reference biomarkers by FK. */
export async function syncBiomarkers() {
  for (const b of BIOMARKERS) {
    const row = { id: b.id, canonicalName: b.canonicalName, bgName: b.bgName, category: b.category, unit: b.unit, supportedUnits: b.supportedUnits, loinc: b.loinc, description: b.description, source: b.source };
    await db.insert(biomarkers).values(row).onConflictDoUpdate({ target: biomarkers.id, set: row });
  }
  await db.delete(biomarkerAliases);
  const aliases = BIOMARKERS.flatMap((b) => [b.canonicalName, b.bgName, ...b.aliases].map((a) => ({ aliasKey: normalizeAliasKey(a), alias: a, biomarkerId: b.id })));
  const unique = [...new Map(aliases.map((a) => [a.aliasKey, a])).values()];
  await db.insert(biomarkerAliases).values(unique);
}

export async function runMigrations() {
  await db.execute(sql`create extension if not exists pgcrypto`);
  await migrate(db, { migrationsFolder: folder });
  await syncBiomarkers();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => console.log('Migrations applied, biomarker catalog synced.'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => sqlClient.end());
}
