-- AlterTable
ALTER TABLE "consent_categories" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Data backfill (F-16 follow-up): tag existing consent history with the
-- categories it belongs to, so historical per-category statistics populate.
--
-- A category governs a granted scope when the scope is in its configured
-- `scopes`, or — when `scopes` is empty (unconfigured) — when the category
-- `key` equals one of the granted scopes (the convention default; explicit
-- `scopes` config overrides it). Only rows not already tagged and matching at
-- least one category are updated; everything else is left untouched.
UPDATE "user_consent_history" uch
SET "metadata" = jsonb_set(
  COALESCE(uch."metadata", '{}'::jsonb),
  '{categoryKeys}',
  sub.keys
)
FROM (
  SELECT h."id" AS id,
         to_jsonb(array_agg(DISTINCT cc."key" ORDER BY cc."key")) AS keys
  FROM "user_consent_history" h
  JOIN "users" u ON u."id" = h."user_id"
  JOIN "consent_categories" cc
    ON cc."realm_id" = u."realm_id"
   AND cc."enabled" = true
   AND (
     cc."scopes" && h."scopes"
     OR (cardinality(cc."scopes") = 0 AND cc."key" = ANY(h."scopes"))
   )
  WHERE (h."metadata" -> 'categoryKeys') IS NULL
  GROUP BY h."id"
) sub
WHERE uch."id" = sub."id";
