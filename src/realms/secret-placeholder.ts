/**
 * What the API returns in place of a stored secret, and what a client sends
 * back to mean "leave it as it is" (SMTP password, SMS and email provider
 * credentials).
 */
export const SECRET_PLACEHOLDER = '••••••';

/** Rejects a value that still has the marker in it, e.g. typed after it. */
export const PLACEHOLDER_TYPED_OVER =
  '$property still contains the hidden-value marker; clear the field before entering a new value';
