/**
 * Escape a string for safe interpolation into HTML text or a double-quoted
 * attribute. Used when building HTML email bodies from values that may contain
 * user-controlled data (display names, IP addresses, User-Agent, URLs, etc.)
 * to prevent HTML/script injection (CodeQL js/xss).
 */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
