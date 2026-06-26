/**
 * Єдине джерело JWT-секрету. У production вимагає JWT_SECRET у середовищі —
 * fail-fast замість тихого фолбеку на загальновідомий рядок 'secret'.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return 'dev-secret-change-me';
}

export const JWT_EXPIRES_IN = '12h';
