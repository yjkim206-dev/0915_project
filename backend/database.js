const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const configuredDatabaseFile = process.env.DB_FILE || './data/app.db';
const databaseFile = path.resolve(__dirname, configuredDatabaseFile);
fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
const db = new sqlite3.Database(databaseFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, bio TEXT DEFAULT '', profile_image TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN profile_image TEXT DEFAULT ''`, () => {});
  db.run(`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, category TEXT DEFAULT '자유', author_id INTEGER, views INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (author_id) REFERENCES users(id))`);
  db.run(`ALTER TABLE posts ADD COLUMN category TEXT DEFAULT '자유'`, () => {});
  db.run(`ALTER TABLE posts ADD COLUMN is_hidden INTEGER DEFAULT 0`, () => {});
  db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, author_id INTEGER NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (author_id) REFERENCES users(id))`);
  db.run(`ALTER TABLE comments ADD COLUMN is_hidden INTEGER DEFAULT 0`, () => {});
  db.run(`CREATE TABLE IF NOT EXISTS post_reactions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (post_id, user_id), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (user_id) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS post_views (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (post_id, user_id), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (user_id) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS admin_account (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`ALTER TABLE admin_account ADD COLUMN profile_image TEXT DEFAULT ''`, () => {});
  const adminName = process.env.ADMIN_NAME || '관리자';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@moa.com';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const adminPasswordHash = adminPassword ? hashPassword(adminPassword) : '';
  db.run('INSERT OR IGNORE INTO admin_account (id, name, email, password) VALUES (1, ?, ?, ?)', [adminName, adminEmail, adminPasswordHash]);
  db.run("UPDATE users SET name = '김민수', bio = '새로운 것을 배우고 나누는 사람' WHERE id = 1 AND (name LIKE '%?%' OR bio LIKE '%?%')");
  if (adminPasswordHash) db.run('UPDATE admin_account SET password = ? WHERE id = 1', [adminPasswordHash]);
});

console.log(`SQLite database ready: ${databaseFile}`);
module.exports = db;
