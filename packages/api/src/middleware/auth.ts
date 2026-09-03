import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { verifyToken } from '../services/api-tokens';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  // Помечает запрос, аутентифицированный служебным API-токеном (cs_...), а не
  // полноценной сессией (JWT логина). Используется, чтобы отдельно закрыть
  // маршруты, которые выдают новые учётные данные или меняют состояние аккаунта —
  // им токен не доверяется, даже если req.user заполнен.
  authKind?: 'session' | 'api-token';
  tokenId?: number;
}

const API_TOKEN_PREFIX = 'cs_';

export async function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  // Try Authorization header first
  const header = req.headers['authorization'];
  let token = header ? (header.startsWith('Bearer ') ? header.slice(7) : header) : '';

  // Fallback: JWT in query param (for direct URL downloads on mobile). API-токены
  // (cs_...) из query-параметра НЕ принимаются ни при каких условиях — иначе сырой
  // токен оседает в логах nginx, истории браузера и заголовке Referer. Такое
  // значение просто игнорируется, запрос остаётся анонимным вместо попытки
  // разобрать его как JWT.
  if (!token && req.query['token']) {
    const queryToken = String(req.query['token']);
    if (!queryToken.startsWith(API_TOKEN_PREFIX)) {
      token = queryToken;
    }
  }

  if (!token) {
    next();
    return;
  }

  // Служебный API-токен (cs_...) — отдельная ветка проверки по хешу, не JWT.
  // Сам токен нигде не логируется, даже при ошибке проверки.
  if (token.startsWith(API_TOKEN_PREFIX)) {
    try {
      const result = await verifyToken(token);
      if (result) {
        // У API-токена нет своих email/name/role — минимальные права ('user').
        // Это защита в глубину, а не единственная граница: маршруты, которые
        // выдают новые учётные данные или меняют состояние аккаунта, дополнительно
        // проверяют req.authKind через denyApiTokenAuth() и отказывают токену
        // независимо от того, какая роль сюда подставлена.
        req.user = { id: result.userId, email: '', name: '', role: 'user' };
        req.authKind = 'api-token';
        req.tokenId = result.tokenId;
      }
    } catch {
      // Проверка не удалась — продолжаем без пользователя
    }
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser & { purpose?: string };
    // Scoped download tokens are NOT sessions — they only work on the download route.
    if (payload.purpose !== 'download') {
      req.user = payload;
      req.authKind = 'session';
    }
  } catch {
    // Invalid token — continue without user
  }
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  // Проверка не просто на truthy req.user, а на числовой req.user.id: OAuth
  // state-JWT (google-calendar.ts/yandex-calendar.ts/todoist.ts) подписан тем же
  // JWT_SECRET, но несёт { userId } (не { id }) и не имеет claim'а purpose —
  // внутри своих 10 минут жизни, отправленный как Bearer, он проходил ветку
  // JWT в authMiddleware и делал req.user truthy ({ userId: N }, без id).
  // Сегодня это не течёт данные — getUserId() читает req.user?.id и получает
  // null, роуты фейлятся закрыто, — но токен не того типа не должен проходить
  // сам гейт аутентификации.
  if (!req.user || typeof req.user.id !== 'number') {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  next();
}

/**
 * Блокирует запросы, аутентифицированные служебным API-токеном (cs_...), на
 * маршрутах, которые выдают новые учётные данные (JWT-сессию, новый API-токен)
 * или меняют состояние аккаунта (пароль, план). Ставится ПОСЛЕ requireAuth.
 * Анонимные запросы этот guard не трогает — их отклонит requireAuth раньше.
 */
export function denyApiTokenAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.authKind === 'api-token') {
    res.status(403).json({ success: false, error: 'Служебный API-токен не может использоваться для этой операции' });
    return;
  }
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }
  next();
}
