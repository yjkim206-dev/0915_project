const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'moa-local-session-secret-change-in-production';

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '4mb' }));

const sessions = new Map();
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};
const verifyPassword = (password, stored) => {
  if (typeof password !== 'string' || typeof stored !== 'string' || !stored) return false;
  if (!stored.startsWith('scrypt$')) return password === stored;
  const [, salt, expected] = stored.split('$');
  if (!salt || !expected || !/^[a-f0-9]+$/i.test(expected)) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};
const createSession = (user) => {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;
  sessions.set(token, user);
  return token;
};
const readSession = (token) => {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!user.exp || user.exp < Date.now()) return null;
    const { exp, ...sessionUser } = user;
    return sessionUser;
  } catch {
    return null;
  }
};
const getAuthUser = (req) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  return token && (sessions.get(token) || readSession(token));
};
const requireAuth = (req, res, next) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: '로그인이 필요합니다.' });
  req.user = user;
  next();
};
const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ message: '관리자 권한이 필요합니다.' });
    next();
  });
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || !password || password.length < 8) {
    return res.status(400).json({ message: '이름, 올바른 이메일, 8자 이상의 비밀번호를 입력해주세요.' });
  }
  db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name.trim(), normalizedEmail, hashPassword(password)], function (error) {
    if (error) return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });
    const user = { id: this.lastID, name: name.trim(), email: normalizedEmail, isAdmin: false };
    return res.status(201).json({ token: createSession(user), user });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  db.get('SELECT id, name, email, password FROM users WHERE lower(trim(email)) = ?', [normalizedEmail], (error, user) => {
    if (error || !user || !verifyPassword(password, user.password)) return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    return res.json({ token: createSession({ id: user.id, name: user.name, email: user.email, isAdmin: false }), user: { id: user.id, name: user.name, email: user.email } });
  });
});

app.get('/api/profile', requireAuth, (req, res) => {
  db.get(`SELECT id, name, email, bio, profile_image, created_at,
    (SELECT COUNT(*) FROM posts WHERE posts.author_id = users.id) AS post_count,
    (SELECT COUNT(DISTINCT category) FROM posts WHERE posts.author_id = users.id AND category IS NOT NULL AND category != '') AS topic_count
    FROM users WHERE id = ?`, [req.user.id], (error, profile) => {
    if (error) return res.status(500).json({ message: '프로필을 불러오지 못했습니다.' });
    if (!profile) return res.status(404).json({ message: '프로필을 찾을 수 없습니다.' });
    db.all(`SELECT posts.id, posts.title, posts.content, posts.author_id, posts.views,
      posts.category, posts.created_at, posts.is_hidden
      FROM posts WHERE posts.author_id = ? ORDER BY posts.created_at DESC`, [req.user.id], (postsError, posts) => {
      if (postsError) return res.status(500).json({ message: '작성한 게시글을 불러오지 못했습니다.' });
      return res.json({ ...profile, posts: posts.map((post) => ({ ...post, is_hidden: Boolean(post.is_hidden) })) });
    });
  });
});

app.put('/api/profile', requireAuth, (req, res) => {
  const { name, bio = '', profileImage = '' } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: '이름을 입력해주세요.' });
  if (String(bio).length > 200) return res.status(400).json({ message: '소개는 200자 이하로 입력해주세요.' });
  db.run('UPDATE users SET name = ?, bio = ?, profile_image = ? WHERE id = ?', [name.trim(), String(bio).trim(), profileImage, req.user.id], (error) => {
    if (error) return res.status(500).json({ message: '프로필을 저장하지 못했습니다.' });
    req.user.name = name.trim();
    db.get(`SELECT id, name, email, bio, profile_image, created_at,
      (SELECT COUNT(*) FROM posts WHERE posts.author_id = users.id) AS post_count,
      (SELECT COUNT(DISTINCT category) FROM posts WHERE posts.author_id = users.id AND category IS NOT NULL AND category != '') AS topic_count
      FROM users WHERE id = ?`, [req.user.id], (readError, profile) => {
      if (readError) return res.status(500).json({ message: '저장된 프로필을 불러오지 못했습니다.' });
      return res.json(profile);
    });
  });
});

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT id, name, email, password FROM admin_account WHERE id = 1', (error, account) => {
    if (error || !account || email !== account.email || !verifyPassword(password, account.password)) {
      return res.status(401).json({ message: '관리자 이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    return res.json({ message: '관리자 로그인 성공', token: createSession({ id: account.id, name: account.name, email: account.email, isAdmin: true }), isAdmin: true, account: { id: account.id, name: account.name, email: account.email } });
  });
});

app.get('/api/admin/account', requireAdmin, (req, res) => {
  db.get('SELECT id, name, email, profile_image, updated_at FROM admin_account WHERE id = 1', (error, account) => {
    if (error) return res.status(500).json({ message: '관리자 계정 정보를 불러오지 못했습니다.' });
    if (!account) return res.status(404).json({ message: '관리자 계정을 찾을 수 없습니다.' });
    return res.json(account);
  });
});

app.put('/api/admin/account', requireAdmin, (req, res) => {
  const { name, email, profileImage = '', currentPassword, newPassword } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: '관리자 이름을 입력해주세요.' });
  if (!email || !email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return res.status(400).json({ message: '올바른 이메일을 입력해주세요.' });

  db.get('SELECT password FROM admin_account WHERE id = 1', (readError, account) => {
    if (readError || !account) return res.status(404).json({ message: '관리자 계정을 찾을 수 없습니다.' });
    if (newPassword && (!currentPassword || !verifyPassword(currentPassword, account.password))) return res.status(401).json({ message: '현재 비밀번호가 올바르지 않습니다.' });
    if (newPassword && newPassword.length < 8) return res.status(400).json({ message: '새 비밀번호는 8자 이상이어야 합니다.' });
    if (String(profileImage).length > 3 * 1024 * 1024) return res.status(400).json({ message: '프로필 이미지는 3MB 이하로 업로드해주세요.' });
    const password = newPassword ? hashPassword(newPassword) : account.password;
    db.run('UPDATE admin_account SET name = ?, email = ?, profile_image = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [name.trim(), email.trim(), profileImage, password], (error) => {
      if (error) return res.status(409).json({ message: '이미 사용 중인 이메일이거나 저장에 실패했습니다.' });
      db.get('SELECT id, name, email, profile_image, updated_at FROM admin_account WHERE id = 1', (readUpdatedError, updated) => {
        if (readUpdatedError) return res.status(500).json({ message: '변경된 계정 정보를 불러오지 못했습니다.' });
        return res.json(updated);
      });
    });
  });
});

app.get('/api/posts', (req, res) => {
  db.all(`SELECT posts.id, posts.title, posts.content, posts.author_id, posts.views, posts.category, posts.created_at,
    (SELECT COUNT(*) FROM post_reactions WHERE post_id = posts.id AND reaction = 'like') AS likes,
    (SELECT COUNT(*) FROM post_reactions WHERE post_id = posts.id AND reaction = 'dislike') AS dislikes,
    CASE WHEN posts.author_id IS NULL THEN (SELECT name FROM admin_account WHERE id = 1) ELSE users.name END AS author
    FROM posts LEFT JOIN users ON users.id = posts.author_id WHERE posts.is_hidden = 0 ORDER BY posts.created_at DESC`, (error, posts) => {
    if (error) return res.status(500).json({ message: '게시글을 불러오지 못했습니다.' });
    return res.json(posts.map((post) => ({ ...post, author: post.author || '알 수 없음', category: post.category || '자유' })));
  });
});

app.get('/api/admin/posts', requireAdmin, (req, res) => {
  db.all('SELECT posts.id, posts.title, posts.content, posts.author_id, posts.views, posts.category, posts.created_at, posts.is_hidden, CASE WHEN posts.author_id IS NULL THEN (SELECT name FROM admin_account WHERE id = 1) ELSE users.name END AS author FROM posts LEFT JOIN users ON users.id = posts.author_id ORDER BY posts.created_at DESC', (error, posts) => {
    if (error) return res.status(500).json({ message: '관리자 게시글 목록을 불러오지 못했습니다.' });
    return res.json(posts.map((post) => ({ ...post, author: post.author || '알 수 없음', category: post.category || '자유', is_hidden: Boolean(post.is_hidden) })));
  });
});

app.post('/api/admin/posts', requireAdmin, (req, res) => {
  const { title, content, category = '자유' } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ message: '제목과 내용을 입력해주세요.' });
  db.run('INSERT INTO posts (title, content, category, author_id) VALUES (?, ?, ?, NULL)', [title.trim(), content.trim(), String(category).trim() || '자유'], function (error) {
    if (error) return res.status(500).json({ message: '관리자 게시글을 저장하지 못했습니다.' });
    return res.status(201).json({ id: this.lastID, title: title.trim(), content: content.trim(), category: String(category).trim() || '자유', author_id: null, author: req.user.name, views: 0, is_hidden: false, created_at: new Date().toISOString() });
  });
});

app.put('/api/admin/posts/:id', requireAdmin, (req, res) => {
  const { title, content, category = '자유' } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ message: '제목과 내용을 입력해주세요.' });
  db.get('SELECT posts.id, posts.author_id, users.name AS author FROM posts LEFT JOIN users ON users.id = posts.author_id WHERE posts.id = ?', [req.params.id], (readError, post) => {
    if (readError) return res.status(500).json({ message: '게시글을 확인하지 못했습니다.' });
    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    db.run('UPDATE posts SET title = ?, content = ?, category = ? WHERE id = ?', [title.trim(), content.trim(), String(category).trim() || '자유', req.params.id], (updateError) => {
      if (updateError) return res.status(500).json({ message: '관리자 게시글을 수정하지 못했습니다.' });
      return res.json({ id: Number(req.params.id), title: title.trim(), content: content.trim(), category: String(category).trim() || '자유', author_id: post.author_id, author: post.author || req.user.name });
    });
  });
});

app.get('/api/posts/:id', requireAuth, (req, res) => {
  db.get(`SELECT posts.id, posts.title, posts.content, posts.author_id, posts.views,
    posts.category, posts.created_at, posts.is_hidden, users.name AS author
    FROM posts LEFT JOIN users ON users.id = posts.author_id
    WHERE posts.id = ? AND (posts.is_hidden = 0 OR posts.author_id = ?)`, [req.params.id, req.user.id], (error, post) => {
    if (error) return res.status(500).json({ message: '게시글을 불러오지 못했습니다.' });
    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    return res.json({ ...post, is_hidden: Boolean(post.is_hidden), author: post.author || '알 수 없음', category: post.category || '자유' });
  });
});

const checkViewOnce = (req, res, next) => {
  db.get('SELECT created_at FROM post_views WHERE post_id = ? AND user_id = ?', [req.params.id, req.user.id], (lookupError, view) => {
    if (lookupError) return res.status(500).json({ message: '조회수를 확인하지 못했습니다.' });
    const recent = view && Date.now() - new Date(`${view.created_at}Z`).getTime() < 24 * 60 * 60 * 1000;
    const finishWithoutCount = () => db.get('SELECT views FROM posts WHERE id = ? AND is_hidden = 0', [req.params.id], (readError, post) => {
      if (readError) return res.status(500).json({ message: '조회수를 불러오지 못했습니다.' });
      if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
      return res.json({ views: post.views, counted: false });
    });
    if (recent) return finishWithoutCount();
    db.run('INSERT INTO post_views (post_id, user_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(post_id, user_id) DO UPDATE SET created_at = CURRENT_TIMESTAMP', [req.params.id, req.user.id], (saveError) => {
      if (saveError) return res.status(500).json({ message: '조회수를 처리하지 못했습니다.' });
      next();
    });
  });
};

app.post('/api/posts/:id/view', requireAuth, checkViewOnce, (req, res) => {
  db.run('UPDATE posts SET views = views + 1 WHERE id = ? AND is_hidden = 0', [req.params.id], function (error) {
    if (error) return res.status(500).json({ message: '조회수를 처리하지 못했습니다.' });
    if (!this.changes) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    db.get('SELECT views FROM posts WHERE id = ?', [req.params.id], (readError, post) => {
      if (readError) return res.status(500).json({ message: '조회수를 불러오지 못했습니다.' });
      return res.json({ views: post.views });
    });
  });
});

app.get('/api/posts/:id/reactions', (req, res) => {
  const user = getAuthUser(req);
  db.get(`SELECT
    SUM(CASE WHEN reaction = 'like' THEN 1 ELSE 0 END) AS likes,
    SUM(CASE WHEN reaction = 'dislike' THEN 1 ELSE 0 END) AS dislikes
    FROM post_reactions WHERE post_id = ?`, [req.params.id], (countError, counts) => {
    if (countError) return res.status(500).json({ message: '좋아요 정보를 불러오지 못했습니다.' });
    if (!user) return res.json({ likes: counts?.likes || 0, dislikes: counts?.dislikes || 0, reaction: null });
    db.get('SELECT reaction FROM post_reactions WHERE post_id = ? AND user_id = ?', [req.params.id, user.id], (userError, ownReaction) => {
      if (userError) return res.status(500).json({ message: '좋아요 정보를 불러오지 못했습니다.' });
      return res.json({ likes: counts?.likes || 0, dislikes: counts?.dislikes || 0, reaction: ownReaction?.reaction || null });
    });
  });
});

app.post('/api/posts/:id/reactions', requireAuth, (req, res) => {
  const reaction = req.body.reaction === 'dislike' ? 'dislike' : req.body.reaction === 'like' ? 'like' : null;
  if (!reaction) return res.status(400).json({ message: '좋아요 또는 싫어요만 선택할 수 있습니다.' });
  db.get('SELECT id FROM posts WHERE id = ? AND is_hidden = 0', [req.params.id], (readError, post) => {
    if (readError) return res.status(500).json({ message: '게시글을 확인하지 못했습니다.' });
    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    db.get('SELECT reaction FROM post_reactions WHERE post_id = ? AND user_id = ?', [req.params.id, req.user.id], (reactionError, current) => {
      if (reactionError) return res.status(500).json({ message: '좋아요를 처리하지 못했습니다.' });
      const done = () => db.get(`SELECT
        SUM(CASE WHEN reaction = 'like' THEN 1 ELSE 0 END) AS likes,
        SUM(CASE WHEN reaction = 'dislike' THEN 1 ELSE 0 END) AS dislikes
        FROM post_reactions WHERE post_id = ?`, [req.params.id], (countError, counts) => {
        if (countError) return res.status(500).json({ message: '좋아요 정보를 불러오지 못했습니다.' });
        return res.json({ likes: counts?.likes || 0, dislikes: counts?.dislikes || 0, reaction: current?.reaction === reaction ? null : reaction });
      });
      if (current?.reaction === reaction) return db.run('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?', [req.params.id, req.user.id], done);
      if (current) return db.run('UPDATE post_reactions SET reaction = ?, created_at = CURRENT_TIMESTAMP WHERE post_id = ? AND user_id = ?', [reaction, req.params.id, req.user.id], done);
      return db.run('INSERT INTO post_reactions (post_id, user_id, reaction) VALUES (?, ?, ?)', [req.params.id, req.user.id, reaction], done);
    });
  });
});

app.get('/api/posts/:id/comments', (req, res) => {
  db.all('SELECT comments.id, comments.post_id, comments.content, comments.created_at, comments.author_id, users.name AS author FROM comments LEFT JOIN users ON users.id = comments.author_id INNER JOIN posts ON posts.id = comments.post_id WHERE comments.post_id = ? AND comments.is_hidden = 0 AND posts.is_hidden = 0 ORDER BY comments.created_at ASC', [req.params.id], (error, comments) => {
    if (error) return res.status(500).json({ message: '댓글을 불러오지 못했습니다.' });
    return res.json(comments.map((comment) => ({ ...comment, author: comment.author || '알 수 없음' })));
  });
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ message: '댓글 내용을 입력해주세요.' });
  if (content.length > 500) return res.status(400).json({ message: '댓글은 500자 이하로 작성해주세요.' });
  db.get('SELECT id FROM posts WHERE id = ? AND is_hidden = 0', [req.params.id], (readError, post) => {
    if (readError) return res.status(500).json({ message: '게시글을 확인하지 못했습니다.' });
    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
      db.run('INSERT INTO comments (post_id, author_id, content, is_hidden) VALUES (?, ?, ?, 0)', [req.params.id, req.user.id, content], function (error) {
      if (error) return res.status(500).json({ message: '댓글을 저장하지 못했습니다.' });
      return res.status(201).json({ id: this.lastID, post_id: Number(req.params.id), author_id: req.user.id, author: req.user.name, content, created_at: new Date().toISOString() });
    });
  });
});

app.put('/api/comments/:id', requireAuth, (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ message: '댓글 내용을 입력해주세요.' });
  if (content.length > 500) return res.status(400).json({ message: '댓글은 500자 이하로 작성해주세요.' });
  db.get('SELECT id, post_id, author_id FROM comments WHERE id = ? AND is_hidden = 0', [req.params.id], (readError, comment) => {
    if (readError) return res.status(500).json({ message: '댓글을 확인하지 못했습니다.' });
    if (!comment) return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    if (comment.author_id !== req.user.id) return res.status(403).json({ message: '작성한 댓글만 수정할 수 있습니다.' });
    db.run('UPDATE comments SET content = ? WHERE id = ?', [content, req.params.id], (updateError) => {
      if (updateError) return res.status(500).json({ message: '댓글을 수정하지 못했습니다.' });
      return res.json({ ...comment, content, author_id: req.user.id, author: req.user.name });
    });
  });
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  db.get('SELECT id, author_id FROM comments WHERE id = ?', [req.params.id], (readError, comment) => {
    if (readError) return res.status(500).json({ message: '댓글을 확인하지 못했습니다.' });
    if (!comment) return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    if (comment.author_id !== req.user.id) return res.status(403).json({ message: '작성한 댓글만 삭제할 수 있습니다.' });
    db.run('DELETE FROM comments WHERE id = ?', [req.params.id], (deleteError) => {
      if (deleteError) return res.status(500).json({ message: '댓글을 삭제하지 못했습니다.' });
      return res.status(204).send();
    });
  });
});

app.get('/api/admin/comments', requireAdmin, (req, res) => {
  db.all('SELECT comments.id, comments.post_id, comments.content, comments.created_at, comments.author_id, comments.is_hidden, users.name AS author, posts.title AS post_title FROM comments LEFT JOIN users ON users.id = comments.author_id INNER JOIN posts ON posts.id = comments.post_id ORDER BY comments.created_at DESC', (error, comments) => {
    if (error) return res.status(500).json({ message: '댓글 목록을 불러오지 못했습니다.' });
    return res.json(comments.map((comment) => ({ ...comment, author: comment.author || '알 수 없음', is_hidden: Boolean(comment.is_hidden) })));
  });
});

app.patch('/api/admin/comments/:id/visibility', requireAdmin, (req, res) => {
  const hidden = Boolean(req.body.hidden);
  db.run('UPDATE comments SET is_hidden = ? WHERE id = ?', [hidden ? 1 : 0, req.params.id], function (error) {
    if (error) return res.status(500).json({ message: '댓글 공개 상태를 변경하지 못했습니다.' });
    if (!this.changes) return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    return res.json({ id: Number(req.params.id), is_hidden: hidden });
  });
});

app.delete('/api/admin/comments/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM comments WHERE id = ?', [req.params.id], function (error) {
    if (error) return res.status(500).json({ message: '댓글을 삭제하지 못했습니다.' });
    if (!this.changes) return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    return res.status(204).send();
  });
});

app.patch('/api/admin/posts/:id/visibility', requireAdmin, (req, res) => {
  const hidden = Boolean(req.body.hidden);
  db.run('UPDATE posts SET is_hidden = ? WHERE id = ?', [hidden ? 1 : 0, req.params.id], function (error) {
    if (error) return res.status(500).json({ message: '게시글 공개 상태를 변경하지 못했습니다.' });
    if (!this.changes) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    return res.json({ id: Number(req.params.id), is_hidden: hidden });
  });
});

app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM posts WHERE id = ?', [req.params.id], function (error) {
    if (error) return res.status(500).json({ message: '게시글을 삭제하지 못했습니다.' });
    if (!this.changes) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    return res.status(204).send();
  });
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { title, content, category = '자유' } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ message: '제목과 내용을 입력해주세요.' });
  db.run('INSERT INTO posts (title, content, category, author_id) VALUES (?, ?, ?, ?)', [title.trim(), content.trim(), category, req.user.id], function (error) {
    if (error) return res.status(500).json({ message: '게시글을 저장하지 못했습니다.' });
    return res.status(201).json({ id: this.lastID, title: title.trim(), content: content.trim(), author_id: req.user.id, author: req.user.name, category, views: 0, likes: 0, dislikes: 0, created_at: new Date().toISOString() });
  });
});

app.put('/api/posts/:id', requireAuth, (req, res) => {
  const { title, content, category = '자유' } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ message: '제목과 내용을 입력해주세요.' });
  db.get('SELECT posts.id, posts.author_id, users.name AS author FROM posts LEFT JOIN users ON users.id = posts.author_id WHERE posts.id = ?', [req.params.id], (readError, post) => {
    if (readError) return res.status(500).json({ message: '게시글을 확인하지 못했습니다.' });
    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    if (post.author_id !== req.user.id) return res.status(403).json({ message: '작성자만 게시글을 수정할 수 있습니다.' });
    db.run('UPDATE posts SET title = ?, content = ?, category = ? WHERE id = ?', [title.trim(), content.trim(), category, req.params.id], (updateError) => {
      if (updateError) return res.status(500).json({ message: '게시글을 수정하지 못했습니다.' });
      return res.json({ id: Number(req.params.id), title: title.trim(), content: content.trim(), category, author_id: post.author_id, author: post.author || req.user.name });
    });
  });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  db.get('SELECT author_id FROM posts WHERE id = ?', [req.params.id], (readError, post) => {
    if (readError) return res.status(500).json({ message: '게시글을 확인하지 못했습니다.' });
    if (!post) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    if (post.author_id !== req.user.id) return res.status(403).json({ message: '작성자만 게시글을 삭제할 수 있습니다.' });
    db.run('DELETE FROM posts WHERE id = ?', [req.params.id], (deleteError) => {
      if (deleteError) return res.status(500).json({ message: '게시글을 삭제하지 못했습니다.' });
      return res.status(204).send();
    });
  });
});

app.use((req, res) => {
  res.status(404).json({ message: '요청한 API를 찾을 수 없습니다.' });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
