// Attachment files are served by an authenticated, ownership-checked API route.
// Browser <img>/<a> can't send an Authorization header, so we pass the JWT as a
// `?token=` query param (accepted by the API's authMiddleware). The token is
// NEVER persisted into document content: it is added at render time and stripped
// before saving.

const ATTACH_PATH = '/v1/documents/attachments/file/';

function currentToken(): string {
  try {
    return localStorage.getItem('auth_token') || '';
  } catch {
    return '';
  }
}

/** Build a ready-to-use (authenticated) URL for a single attachment filename. */
export function attachmentUrl(filename: string): string {
  return `${ATTACH_PATH}${encodeURIComponent(filename)}?token=${encodeURIComponent(currentToken())}`;
}

// Matches an attachment URL in HTML (src/href), with an optional existing query string.
const ATTACH_URL_RE = new RegExp(
  `(${ATTACH_PATH.replace(/[/]/g, '\\/')}[^"'?\\s]+)(\\?[^"'\\s]*)?`,
  'g',
);

/** Add the current auth token to every attachment URL in an HTML string (for display). */
export function addTokenToAttachments(html: string): string {
  if (!html) return html;
  const token = currentToken();
  return html.replace(ATTACH_URL_RE, (_m, base) => `${base}?token=${encodeURIComponent(token)}`);
}

/** Remove any token query string from attachment URLs (before persisting). */
export function stripTokenFromAttachments(html: string): string {
  if (!html) return html;
  return html.replace(ATTACH_URL_RE, (_m, base) => base);
}
