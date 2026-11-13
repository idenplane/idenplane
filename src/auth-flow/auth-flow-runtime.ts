/**
 * Operator switch for the custom auth-flow runtime.
 *
 * With it off, every login is the built-in one, whatever is bound: the
 * binding resolver answers `legacy` before reading anything, so the runtime,
 * `/auth` and SessionIssuer all stand aside. The admin API reports it as
 * `runtimeEnabled`. Everything reads it through this one helper, at call
 * time, so they can never disagree.
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
