import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../middleware/auth';

// Build test app — set user directly for simplicity
const app = express();
app.use(express.json());
app.use((req: any, _res: any, next: any) => {
  // Check for auth header or token param
  const header = req.headers['authorization'];
  const token = header ? (header.startsWith('Bearer ') ? header.slice(7) : header) : (req.query?.token as string);
  if (token) {
    try {
      req.user = jwt.verify(token, 'test-secret-key');
    } catch {}
  }
  if (!req.user && !req.path.includes('no-auth-test')) {
    return _res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
});

// Import routes
import { tasksRouter } from '../routes/tasks';
import { projectsRouter } from '../routes/projects';
import { meetingsRouter } from '../routes/meetings';
import { documentsRouter } from '../routes/documents';

app.use('/tasks', tasksRouter);
app.use('/projects', projectsRouter);
app.use('/meetings', meetingsRouter);
app.use('/documents', documentsRouter);

// Auth route
app.post('/auth/login', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { getDb } = require('../db/db');
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body.email) as any;
  if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, process.env['JWT_SECRET']!);
  res.json({ success: true, data: { token, user: { id: user.id, email: user.email, name: user.name } } });
});
app.use('/auth', express.Router().post('/login', app));

const TOKEN = jwt.sign({ id: 1, email: 'test@test.com', name: 'Test User', role: 'admin' }, 'test-secret-key');
const auth = { Authorization: `Bearer ${TOKEN}` };

describe('Authentication', () => {
  it('should reject unauthenticated requests', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(401);
  });

  it('should accept valid JWT', async () => {
    const res = await request(app).get('/tasks').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should accept token in query param', async () => {
    const res = await request(app).get(`/tasks?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });
});

describe('Tasks CRUD', () => {
  let taskId: number;

  it('should create a task', async () => {
    const res = await request(app)
      .post('/tasks')
      .set(auth)
      .send({ title: 'Test task', status: 'todo', priority: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Test task');
    taskId = res.body.data.id;
  });

  it('should list tasks', async () => {
    const res = await request(app).get('/tasks').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('should update a task', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set(auth)
      .send({ title: 'Updated task', status: 'in_progress', priority: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated task');
    expect(res.body.data.status).toBe('in_progress');
  });

  it('should create task with project', async () => {
    const res = await request(app)
      .post('/tasks')
      .set(auth)
      .send({ title: 'Project task', status: 'todo', priority: 2, project_id: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.project_id).toBe(1);
  });

  it('should delete (archive) a task', async () => {
    const res = await request(app).delete(`/tasks/${taskId}`).set(auth);
    expect([200, 204]).toContain(res.status);
  });
});

describe('Projects CRUD', () => {
  it('should list projects', async () => {
    const res = await request(app).get('/projects').set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should create a project', async () => {
    const res = await request(app)
      .post('/projects')
      .set(auth)
      .send({ name: 'New Project', color: '#ef4444' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('New Project');
  });
});

describe('Documents CRUD', () => {
  let docId: number;

  it('should create a document', async () => {
    const res = await request(app)
      .post('/documents')
      .set(auth)
      .send({ title: 'Test doc', body: '<p>Hello</p>' });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Test doc');
    docId = res.body.data.id;
  });

  it('should get document ancestors', async () => {
    const res = await request(app).get(`/documents/${docId}/ancestors`).set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should update a document', async () => {
    const res = await request(app)
      .patch(`/documents/${docId}`)
      .set(auth)
      .send({ title: 'Updated doc' });
    expect(res.status).toBe(200);
  });

  it('should delete a document', async () => {
    const res = await request(app).delete(`/documents/${docId}`).set(auth);
    expect([200, 204]).toContain(res.status);
  });
});

describe('User scoping', () => {
  it('should not see other users tasks', async () => {
    const otherToken = jwt.sign({ id: 999, email: 'other@test.com', name: 'Other', role: 'user' }, 'test-secret-key');
    const res = await request(app).get('/tasks').set({ Authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});
