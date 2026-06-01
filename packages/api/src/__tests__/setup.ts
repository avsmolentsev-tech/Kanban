// TODO: Update tests for PostgreSQL (tests currently disabled during migration)
import * as path from 'path';

// Use in-memory SQLite for tests
process.env['DB_PATH'] = ':memory:';
process.env['VAULT_PATH'] = path.join(__dirname, '../../test-vault');
process.env['JWT_SECRET'] = 'test-secret-key';
process.env['OPENAI_API_KEY'] = 'test-key';

// TODO: Rewrite test setup for PostgreSQL
// beforeAll(() => {
//   initDb();
//   const db = getDb();
//   // Create test user
//   const bcrypt = require('bcryptjs');
//   const hash = bcrypt.hashSync('testpass123', 10);
//   db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(1, 'test@test.com', hash, 'Test User', 'admin');
//   db.prepare('INSERT OR IGNORE INTO projects (id, name, color, user_id) VALUES (?, ?, ?, ?)').run(1, 'Test Project', '#6366f1', 1);
// });

// afterAll(() => {
//   closeDb();
// });
