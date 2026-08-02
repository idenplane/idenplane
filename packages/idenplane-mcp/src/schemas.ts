import { z } from 'zod';

/**
 * Safe character set for values that get interpolated into an admin API URL
 * path (realm name, user ID, client ID, session ID, ...). `IdenplaneClient`
 * builds request URLs via template literals without encoding, so without
 * this constraint a value like `../../admin/some-other-endpoint` or a
 * percent-encoded traversal sequence would be interpolated verbatim, letting
 * a malicious or compromised LLM tool-call redirect requests to an
 * unintended admin API path.
 */
const PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PATH_SEGMENT_MESSAGE = 'must contain only letters, numbers, underscores, and hyphens';

/**
 * Builds a `z.string()` restricted to characters safe for URL path
 * interpolation (see the rationale above {@link PATH_SEGMENT_PATTERN}).
 *
 * @param description Human-readable description attached to the schema via `.describe()`,
 *   surfaced to MCP clients as the parameter's documentation.
 * @returns A Zod string schema requiring a non-empty value matching {@link PATH_SEGMENT_PATTERN}.
 */
export function pathSegment(description: string): z.ZodString {
  return z.string().min(1).regex(PATH_SEGMENT_PATTERN, PATH_SEGMENT_MESSAGE).describe(description);
}
