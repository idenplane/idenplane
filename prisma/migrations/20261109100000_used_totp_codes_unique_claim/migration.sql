-- A TOTP code is claimed by inserting its row, so two concurrent submissions
-- of the same code cannot both succeed. The unique index is what makes the
-- insert a claim. Duplicates that the old check-then-insert let through are
-- removed first, keeping each code's latest row.
DELETE FROM "used_totp_codes" a
  USING "used_totp_codes" b
  WHERE a."user_id" = b."user_id"
    AND a."code_hash" = b."code_hash"
    AND (a."expires_at", a."id") < (b."expires_at", b."id");

CREATE UNIQUE INDEX "used_totp_codes_user_id_code_hash_key" ON "used_totp_codes"("user_id", "code_hash");
