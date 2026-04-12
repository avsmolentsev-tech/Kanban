import request from 'supertest';
import express from 'express';
import { initTestDb, closeDb, getDb } from '../db/db';
import { authRouter } from '../routes/auth';
import { tasksRouter } from '../routes/tasks';
import { projectsRouter } from '../routes/projects';
import { authMiddleware, requireAuth } from '../middleware/auth';

// Build a minimal app — mirrors src/index.ts without calling start()
const app = express();
app.use(express.json());
app.use(authMiddleware);

// Public routes
app.use('/v1/auth', authRouter);

// Protected routes
app.use('/v1/tasks', requireAuth, tasksRouter);
app.use('/v1/projects', requireAuth, projectsRouter);

// ─── Helpers ────────────────────────────────────────────────────────────────

function createUsersTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      name          TEXT    NOT NULL DEFAULT '',
      role          TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  // user_id FK column on tasks and projects (nullable for backward compat)
  try { db.exec('ALTER TABLE tasks ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
}

// ─── Test state ─────────────────────────────────────────────────────────────

let token: string;
let taskId: number;
let projectId: number;

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(() => {
  initTestDb();
  createUsersTable();
});

afterAll(() => {
  closeDb();
});

// ─── Auth ───────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('POST /v1/auth/register — creates user and returns token', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: 'test@example.com', password: 'password123', name: 'Test User' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.user.role).toBe('admin'); // first user becomes admin

    // Capture token for subsequent tests
    token = res.body.data.token;
  });

  it('POST /v1/auth/register — rejects duplicate email', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('POST /v1/auth/login — returns token for valid credentials', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe('test@example.com');
  });

  it('POST /v1/auth/login — rejects invalid password', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /v1/auth/me — returns current user with valid token', async () => {
    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('test@example.com');
  });
});

// ─── Protected routes — 401 without token ────────────────────────────────────

describe('Protected routes', () => {
  it('GET /v1/tasks without token — returns 401', async () => {
    const res = await request(app).get('/v1/tasks');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── Tasks ──────────────────────────────────────────────────────────────────

describe('Tasks (authenticated)', () => {
  it('GET /v1/tasks — returns array', async () => {
    const res = await request(app)
      .get('/v1/tasks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /v1/tasks — creates task', async () => {
    const res = await request(app)
      .post('/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Task', description: 'Task description', status: 'backlog' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Test Task');
    expect(res.body.data.id).toBeDefined();

    taskId = res.body.data.id;
  });

  it('PATCH /v1/tasks/:id — updates task', async () => {
    const res = await request(app)
      .patch(`/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Task', status: 'todo' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Updated Task');
    expect(res.body.data.status).toBe('todo');
  });

  it('DELETE /v1/tasks/:id — archives task', async () => {
    const res = await request(app)
      .delete(`/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Projects ───────────────────────────────────────────────────────────────

describe('Projects (authenticated)', () => {
  it('GET /v1/projects — returns array', async () => {
    const res = await request(app)
      .get('/v1/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /v1/projects — creates project', async () => {
    const res = await request(app)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Project', description: 'A test project' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Project');
    expect(res.body.data.id).toBeDefined();

    projectId = res.body.data.id;
  });
});
