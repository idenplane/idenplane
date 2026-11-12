/**
 * Operator switch for the custom auth-flow runtime.
 *
 * The runtime itself is not wired into login yet. Until it is, this flag only
 * changes what the binding resolver would answer and what the admin API
 * reports as `runtimeEnabled`. Both read it through this one helper so they
 * can never disagree.
 *
 * Enabled only by the exact (case-insensitive) value `true`, matching the
 * other boolean env switches in this codebase. Unset, empty or anything else
 * means legacy login.
 */
export const AUTH_FLOW_RUNTIME_ENV = 'AUTH_FLOW_RUNTIME_ENABLED';

export function isAuthFlowRuntimeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[AUTH_FLOW_RUNTIME_ENV]?.trim().toLowerCase() === 'true';
}
