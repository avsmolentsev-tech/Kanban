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
        // У API-токена нет своих email/name/role — минимальные права ('user'),
        // чтобы служебный доступ не мог случайно получить админские привилегии.
        req.user = { id: result.userId, email: '', name: '', role: 'user' };
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
    }
  } catch {
    // Invalid token — continue without user
  }
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
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
