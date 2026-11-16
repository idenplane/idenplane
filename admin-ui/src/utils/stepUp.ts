import { mfaRefusalOf } from '../api/adminMfa';
import { waitForStepUp } from '../api/client';

/**
 * Runs `action`; when the server asks for the second factor again (a
 * sensitive action needs a recent check, or the session has none),
 * StepUpPrompt opens, and the action is retried once after the admin has
 * verified. Cancelling the prompt rethrows the original error.
 */
export async function withStepUp<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const refusal = mfaRefusalOf(error);
    if (
      refusal !== 'admin_recent_mfa_required' &&
      refusal !== 'admin_mfa_step_up_required'
    ) {
      throw error;
    }
    if (!(await waitForStepUp())) throw error;
    return action();
  }
}
