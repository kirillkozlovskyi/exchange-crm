import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Ковзне подовження сесії ──────────────────────────────────────────────────
// Токен живе 12 год; поки касир активно працює — тихо оновлюємо його у фоні,
// коли лишається < 6 год (не частіше, ніж раз на 10 хв). Так зміна не
// обірветься посеред роботи через прострочений токен.
const REFRESH_WHEN_LEFT_MS = 6 * 60 * 60 * 1000;
const REFRESH_THROTTLE_MS = 10 * 60 * 1000;
let lastRefreshAttempt = 0;

function tokenExpMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function maybeRefreshToken() {
  const token = localStorage.getItem('token');
  if (!token) return;
  const exp = tokenExpMs(token);
  if (exp === null) return;
  const now = Date.now();
  if (exp - now > REFRESH_WHEN_LEFT_MS) return; // ще свіжий
  if (now - lastRefreshAttempt < REFRESH_THROTTLE_MS) return;
  lastRefreshAttempt = now;
  try {
    const { data } = await api.post('/auth/refresh');
    if (data?.access_token) localStorage.setItem('token', data.access_token);
  } catch {
    /* не вдалось — спробуємо пізніше; 401 обробить основний інтерцептор */
  }
}

api.interceptors.response.use(
  (r) => {
    // Фонове подовження — не блокуємо відповідь.
    void maybeRefreshToken();
    return r;
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
