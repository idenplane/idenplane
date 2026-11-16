-- Exact redirect URI matching (0.11.0, RFC 9700, ASVS 5.0 V10.4.1).
--
-- From 0.11.0 a registered redirect URI ending in "/*" no longer matches the
-- paths below it, unless the client has allow_insecure_wildcard_redirect_uris
-- on. So that no client stops working on upgrade, the flag is turned on here
-- for every client that already has such an entry in redirect_uris or
-- post_logout_redirect_uris. Those clients behave exactly as before, are
-- listed as a warning by GET /admin/upgrade/health ("wildcard_redirect_uris")
-- and are flagged in the admin console until an administrator replaces the
-- wildcards with exact URIs and turns the flag off. New clients, and clients
-- without a wildcard today, get exact matching.
ALTER TABLE "clients"
  ADD COLUMN "allow_insecure_wildcard_redirect_uris" BOOLEAN NOT NULL DEFAULT false;

UPDATE "clients"
   SET "allow_insecure_wildcard_redirect_uris" = true
 WHERE EXISTS (
         SELECT 1
           FROM unnest("redirect_uris" || "post_logout_redirect_uris") AS u(uri)
          WHERE u.uri LIKE '%/*'
       );
