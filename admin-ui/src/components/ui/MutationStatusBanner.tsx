import { Alert } from './Alert';
import { getErrorMessage } from '../../utils/getErrorMessage';

export interface MutationStatusBannerProps {
  mutation: { isSuccess: boolean; isError: boolean; error: unknown };
  successMessage: string;
  errorFallback: string;
}

/**
 * Success/error banner for a form's save mutation, built on the shared
 * `Alert` component. Replaces the hand-rolled
 * `rounded-md bg-success-soft p-3 text-sm text-success-fg` / danger pair
 * that EmailProviderForm and SmsProviderForm each repeated verbatim.
 */
export function MutationStatusBanner({
  mutation,
  successMessage,
  errorFallback,
}: MutationStatusBannerProps) {
  if (mutation.isSuccess) {
    return (
      <Alert variant="success" role="status">
        {successMessage}
      </Alert>
    );
  }
  if (mutation.isError) {
    return <Alert variant="danger">{getErrorMessage(mutation.error, errorFallback)}</Alert>;
  }
  return null;
}
