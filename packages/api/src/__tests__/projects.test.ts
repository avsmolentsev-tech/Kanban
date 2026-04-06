import request from 'supertest';
import express from 'express';
import { initTestDb, closeDb } from '../db/db';
import { projectsRouter } from '../routes/projects';
import { ok } from '@pis/shared';

const app = express();
app.use(express.json());
app.use('/projects', projectsRouter);

describe('Projects API', () => {
  beforeEach(() => initTestDb());
  afterEach(() => closeDb());

  it('GET /projects returns empty list', async () => {
    const res = await request(app).get('/projects');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /projects creates a project', async () => {
    const res = await request(app).post('/projects').send({ name: 'Test', description: 'desc' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Test');
  });

  it('POST /projects returns 400 without name', async () => {
    const res = await request(app).post('/projects').send({});
    expect(res.status).toBe(400);
  });
});
