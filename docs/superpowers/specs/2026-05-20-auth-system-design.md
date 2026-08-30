# Auth System Design — Clarity Space

**Date:** 2026-05-20
**Status:** Approved

## Overview

Transition from hardcoded admin to full email-based auth with optional Telegram linking.

## Registration Flow

1. User enters email + password (min 8 chars)
2. 6-digit code sent via Resend (TTL 10 min)
3. User enters code → account verified → JWT issued → logged in

## Login

- Email + password → JWT access token (24h) + refresh token (30d)
- Refresh token in httpOnly cookie, access token in localStorage

## Password Reset

1. Enter email → 6-digit code to email
2. Enter code → new password form → done

## Telegram Linking (optional)

- Settings page: "Link Telegram" button
- Bot generates one-time code → user enters in web → tg_id linked
- After linking, bot works with this user's data

## Database

### New `users` table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password_hash TEXT,
  email_verified INTEGER DEFAULT 0,
  tg_id INTEGER UNIQUE,
  name TEXT,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

### New `verification_codes` table
```sql
CREATE TABLE verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL, -- 'register' | 'reset'
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

## Migration

- Existing user_id (2, 4, 6) migrated: INSERT INTO users (id, tg_id) from current data
- First login prompts "Set email and password"
- All FK references (tasks.user_id, meetings.user_id, etc.) point to users.id

## New API Endpoints

- `POST /auth/register` — email, password, name
- `POST /auth/verify-email` — email, code
- `POST /auth/login` — email, password
- `POST /auth/refresh` — refresh token cookie
- `POST /auth/forgot-password` — email
- `POST /auth/reset-password` — email, code, new_password
- `POST /auth/link-telegram` — one-time code from bot
- `GET /auth/me` — current user profile

## New Files

- `packages/api/src/routes/auth.ts` — auth endpoints
- `packages/api/src/services/email.service.ts` — Resend SDK wrapper
- `apps/web/src/pages/LoginPage.tsx`
- `apps/web/src/pages/RegisterPage.tsx`
- `apps/web/src/pages/ForgotPasswordPage.tsx`
- `apps/web/src/pages/VerifyEmailPage.tsx`

## What Changes

- Auth middleware: verify JWT, extract userId from token
- App.tsx: protected routes, redirect to login if not authenticated
- Remove hardcoded admin login

## What Stays

- All user_id scoping in API — already works
- Vault structure user_N/ — stays
- TG bot resolveUserId — links via users.tg_id

## Tech Stack

- **Password hashing:** bcrypt
- **JWT:** jsonwebtoken (already in deps)
- **Email:** Resend SDK
- **Codes:** 6-digit random, stored in verification_codes table
