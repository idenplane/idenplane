-- Identity provider types in their canonical, lower-case form (0.13.0).
--
-- Since 0.12.0 the admin API and the importers store provider_type as
-- 'oidc' or 'oauth2' only, lower-case. Rows saved earlier may carry a
-- supported type in another case or with spaces ('OIDC', 'OAuth2 '): they
-- are rewritten to the canonical value here. Nothing else changes: a row
-- of any other type (SAML, or anything else saved before 0.12.0) is left
-- as it is and reported by GET /admin/upgrade/health
-- (identity_provider_types) for an admin to review.

-- Normalize
UPDATE "identity_providers"
   SET "provider_type" = lower(btrim("provider_type"))
 WHERE lower(btrim("provider_type")) IN ('oidc', 'oauth2')
   AND "provider_type" <> lower(btrim("provider_type"));
