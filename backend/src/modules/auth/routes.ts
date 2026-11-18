import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import nodemailer from 'nodemailer';
import { pool, withTransaction } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { hashToken, requireRole } from '../../plugins/auth.js';

const mailer = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

async function sendActivationEmail(email: string, username: string, rawToken: string) {
  const link = `${env.APP_BASE_URL}/activate?token=${rawToken}`;
  if (!mailer) {
    console.log(`\n[DEV EMAIL] Activation link for ${username} (${email}):\n${link}\n`);
    return;
  }
  await mailer.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'Your JSTW Account is Approved',
    text: `Hello ${username},\n\nA moderator has approved your account. Set your password and claim your 1,000 starting Shekels here:\n${link}\n\nThis link expires in 72 hours.`,
  });
}

export async function authRoutes(app: FastifyInstance) {
  // 1. Current session profile
  app.get('/api/auth/me', async (req, reply) => {
    if (!req.currentUser) {
      return reply.status(401).send({ code: 'UNAUTHENTICATED', message: 'Not signed in.' });
    }
    return req.currentUser;
  });

  // 2. Player Signup (Enters PENDING_APPROVAL queue)
  app.post('/api/auth/signup', async (req, reply) => {
    const body = z
      .object({
        username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
        email: z.string().trim().email().max(255),
      })
      .parse(req.body);

    try {
      await pool.query(
        `INSERT INTO users (username, email, status) VALUES ($1, $2, 'PENDING_APPROVAL')`,
        [body.username, body.email.toLowerCase()]
      );
      return reply.status(201).send({ message: 'Application submitted for moderator approval.' });
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.status(409).send({ code: 'DUPLICATE_USER', message: 'Username or email already registered.' });
      }
      throw err;
    }
  });

  // 3. Moderator Queue: List Pending Users
  app.get('/api/mod/pending-users', { preHandler: requireRole(['MODERATOR', 'ADMIN']) }, async () => {
    const { rows } = await pool.query(
      `SELECT id, username, email, role, status, wallet_balance AS "walletBalance", created_at AS "createdAt"
       FROM users WHERE status = 'PENDING_APPROVAL' ORDER BY created_at ASC`
    );
    return rows;
  });

  // 4. Moderator Approve User -> Generate Single-Use Password Setup Link
  app.post('/api/mod/users/:id/approve', { preHandler: requireRole(['MODERATOR', 'ADMIN']) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);

    const user = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE users
         SET status = 'AWAITING_PASSWORD', approved_by = $1
         WHERE id = $2 AND status = 'PENDING_APPROVAL'
         RETURNING id, username, email`,
        [req.currentUser!.id, id]
      );
      if (!rows.length) return null;

      await tx.query(
        `INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at)
         VALUES ($1, $2, 'SET_PASSWORD', NOW() + INTERVAL '72 hours')`,
        [tokenHash, id]
      );
      return rows[0];
    });

    if (!user) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Pending user not found.' });
    }

    await sendActivationEmail(user.email, user.username, rawToken);
    return { message: 'User approved and activation email dispatched.' };
  });

  // 5. Post-Approval Password Setup -> Credits 1,000 Starting Shekels & Logs In
  app.post('/api/auth/activate', async (req, reply) => {
    const body = z
      .object({
        token: z.string().min(16),
        password: z.string().min(10).max(128),
      })
      .parse(req.body);

    const tokenHash = hashToken(body.token);
    const passwordHash = await hash(body.password);
    const rawSid = crypto.randomBytes(32).toString('hex');

    const activated = await withTransaction(async (tx) => {
      const { rows: tokRows } = await tx.query(
        `UPDATE account_tokens
         SET used_at = NOW()
         WHERE token_hash = $1 AND purpose = 'SET_PASSWORD' AND used_at IS NULL AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHash]
      );
      if (!tokRows.length) return false;

      const userId = tokRows[0].user_id;
      const { rows: userRows } = await tx.query(
        `UPDATE users
         SET password_hash = $1, status = 'ACTIVE', wallet_balance = 20000
         WHERE id = $2 AND status = 'AWAITING_PASSWORD'
         RETURNING id`,
        [passwordHash, userId]
      );
      if (!userRows.length) return false;

      await tx.query(
        `INSERT INTO wallet_ledger (user_id, entry_type, amount, balance_after)
         VALUES ($1, 'INITIAL_GRANT', 20000, 20000)`,
        [userId]
      );

      await tx.query(
        `INSERT INTO sessions (id, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '14 days')`,
        [hashToken(rawSid), userId]
      );
      return true;
    });

    if (!activated) {
      return reply.status(400).send({ code: 'INVALID_TOKEN', message: 'Activation link is invalid or expired.' });
    }

    reply.setCookie('sid', rawSid, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 14 * 24 * 60 * 60,
    });
    return { message: 'Account activated with 1,000 Shekels.' };
  });

  // 6. Password Login
  app.post('/api/auth/login', async (req, reply) => {
    const body = z
      .object({
        username: z.string().trim().min(1),
        password: z.string().min(1),
      })
      .parse(req.body);

    const { rows } = await pool.query(
      `SELECT id, password_hash, status FROM users WHERE LOWER(username) = LOWER($1)`,
      [body.username]
    );
    const user = rows[0];
    if (!user || !user.password_hash || !(await verify(user.password_hash, body.password))) {
      return reply.status(401).send({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
    }
    if (user.status === 'DEACTIVATED') {
      return reply.status(403).send({ code: 'DEACTIVATED', message: 'This account is deactivated.' });
    }

    const rawSid = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '14 days')`,
      [hashToken(rawSid), user.id]
    );

    reply.setCookie('sid', rawSid, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 14 * 24 * 60 * 60,
    });
    return { message: 'Signed in.' };
  });

  // 7. Logout
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.cookies?.sid) {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [hashToken(req.cookies.sid)]);
    }
    reply.clearCookie('sid', { path: '/' });
    return { message: 'Signed out.' };
  });
}