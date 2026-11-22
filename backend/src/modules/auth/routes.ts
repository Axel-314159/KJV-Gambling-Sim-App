import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import nodemailer from 'nodemailer';
import { pool, withTransaction } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { hashToken, requireActivePlayer, requireRole } from '../../plugins/auth.js';

const mailer = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export async function sendActivationEmail(
  email: string, 
  username: string, 
  rawToken: string,
  initialGrantGerahs = 2000
) {
  const link = `${env.APP_BASE_URL}/activate?token=${rawToken}`;
  const shekels = Math.floor(initialGrantGerahs / 20);
  const gerahs = initialGrantGerahs % 20;
  const grantLabel =
    gerahs === 0
      ? `${shekels.toLocaleString()} SHK`
      : `${shekels.toLocaleString()} SHK, ${gerahs} GRH`;
  
  if (!mailer) {
    console.log(`\n[DEV EMAIL] Activation link for ${username} (${email}):\n${link}\n`);
    return;
  }
  await mailer.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'Your JSTW Account is Approved',
    text: `Hello ${username},\n\nA moderator has approved your account. Set your password and claim your ${grantLabel} here:\n${link}\n\nThis link expires in 72 hours.`,
    html: `
      <p>Hello <strong>${username}</strong>,</p>
      <p>A moderator has approved your JSTW account.</p>
      <p><a href="${link}">Click here to set your password and claim your <strong>${grantLabel}</strong></a></p>
      <p style="color:#666;font-size:12px;">Or copy this link into your browser: ${link}<br/>This link expires in 72 hours.</p>
    `,
  });
}

async function sendPasswordResetEmail(email: string, username: string, rawToken: string) {
  const link = `${env.APP_BASE_URL}/reset-password?token=${rawToken}`;

  if (!mailer) {
    console.log(`\n[DEV EMAIL] Password reset link for ${username} (${email}):\n${link}\n`);
    return;
  }

  await mailer.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'Reset Your JSTW Password',
    text: `Hello ${username},\n\nWe received a request to reset your password. Choose a new password here:\n${link}\n\nThis link expires in 1 hour. If you did not request this, you can safely ignore this email.`,
    html: `
      <p>Hello <strong>${username}</strong>,</p>
      <p>We received a request to reset your JSTW password.</p>
      <p><a href="${link}">Click here to set a new password</a></p>
      <p style="color:#666;font-size:12px;">Or copy this link into your browser: ${link}<br/>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
    `,
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
  
  app.patch(
    '/api/auth/settings',
    { preHandler: requireActivePlayer },
    async (req) => {
      const { autoRegister } = z
        .object({
          autoRegister: z.boolean(),
        })
        .parse(req.body);

      const { rows } = await pool.query<{ auto_register: boolean }>(
        `UPDATE users
         SET auto_register = $1
         WHERE id = $2
         RETURNING auto_register`,
        [autoRegister, req.currentUser!.id]
      );

      return {
        autoRegister: Boolean(rows[0].auto_register),
      };
    }
  );

  // 2. Player Signup (Enters PENDING_APPROVAL queue)
  app.post('/api/auth/signup', async (req, reply) => {
    const body = z
      .object({
        username: z
          .string()
          .trim()
          .min(3, 'Username must be at least 3 characters')
          .max(40, 'Username must be at most 40 characters')
          .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, underscores, and hyphens'),
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

  const approveBodySchema = z.object({
    initialGrantGerahs: z.number().int().min(0).default(2000),
  });

  // 4. Moderator Approve User -> Generate Single-Use Password Setup Link
  app.post('/api/mod/users/:id/approve', { preHandler: requireRole(['MODERATOR', 'ADMIN']) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { initialGrantGerahs } = approveBodySchema.parse(req.body ?? {});
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);

    const user = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE users
         SET status = 'AWAITING_PASSWORD', 
            approved_by = $1,
            initial_grant = $2
         WHERE id = $3 AND status = 'PENDING_APPROVAL'
         RETURNING id, username, email, initial_grant`,
        [req.currentUser!.id, initialGrantGerahs, id]
      );
      if (!rows.length) return null;

      await tx.query(
        `INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at)
         VALUES ($1, $2, 'SET_PASSWORD', NOW() + INTERVAL '72 hours')`,
        [tokenHash, id]
      );
      return { ...rows[0], rawToken };
    });

    if (!user) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'User not found or already approved.' });
    }

    await sendActivationEmail(
      user.email, 
      user.username, 
      rawToken,
      Number(user.initial_grant)
    );
    return { message: `Approved ${user.username} with ${Math.floor(initialGrantGerahs / 20)} Shekels.` };
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
         SET password_hash = $1, status = 'ACTIVE', wallet_balance = wallet_balance + initial_grant
         WHERE id = $2 AND status = 'AWAITING_PASSWORD'
         RETURNING id, initial_grant, wallet_balance`,
        [passwordHash, userId]
      );

      if (!userRows.length) {
        throw Object.assign(new Error('Account is not awaiting password activation.'), {
          statusCode: 400,
          code: 'INVALID_ACCOUNT_STATE',
        });
      }

      const grantAmount = Number(userRows[0].initial_grant);
      if (grantAmount > 0) {
        await tx.query(
          `INSERT INTO wallet_ledger (user_id, entry_type, amount, balance_after)
          VALUES ($1, 'INITIAL_GRANT', $2, $3)`,
          [userId, grantAmount, Number(userRows[0].wallet_balance)]
        );
      }

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
    return { message: 'Account activated.' };
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

  /* Password Reset Flow */
  // 1. Request a password reset link by email
  app.post('/api/auth/forgot-password', async (req) => {
    const { email } = z
      .object({
        email: z.string().trim().email('Please enter a valid email address.'),
      })
      .parse(req.body);

    const genericResponse = {
      message:
        'If an active account is registered with that email address, a password reset link has been sent.',
    };

    const { rows } = await pool.query<{ id: string; username: string; email: string }>(
      `SELECT id, username, email
       FROM users
       WHERE LOWER(email) = LOWER($1)
         AND status = 'ACTIVE'
       LIMIT 1`,
      [email]
    );

    // Always return the same response so attackers cannot enumerate registered emails
    if (!rows.length) {
      return genericResponse;
    }

    const user = rows[0];
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await withTransaction(async (tx) => {
      // Invalidate any prior unused reset tokens for this user
      await tx.query(
        `UPDATE account_tokens
         SET used_at = NOW()
         WHERE user_id = $1
           AND purpose = 'RESET_PASSWORD'
           AND used_at IS NULL`,
        [user.id]
      );

      await tx.query(
        `INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at)
         VALUES ($1, $2, 'RESET_PASSWORD', NOW() + INTERVAL '1 hour')`,
        [tokenHash, user.id]
      );
    });

    await sendPasswordResetEmail(user.email, user.username, rawToken);

    return genericResponse;
  });

  // 2. Consume the token and update the password
  app.post('/api/auth/reset-password', async (req) => {
    const { token, password } = z
      .object({
        token: z.string().min(16, 'Invalid reset token.'),
        password: z
          .string()
          .min(8, 'Password must be at least 8 characters.')
          .max(128, 'Password must be at most 128 characters.'),
      })
      .parse(req.body);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // Use the exact same password hashing helper/library as your /api/auth/activate route
    const passwordHash = await hash(password);

    await withTransaction(async (tx) => {
      const { rows: tokenRows } = await tx.query<{ user_id: string }>(
        `UPDATE account_tokens
         SET used_at = NOW()
         WHERE token_hash = $1
           AND purpose = 'RESET_PASSWORD'
           AND used_at IS NULL
           AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHash]
      );

      if (!tokenRows.length) {
        throw Object.assign(
          new Error('This password reset link is invalid or has expired. Please request a new one.'),
          { statusCode: 400, code: 'INVALID_OR_EXPIRED_TOKEN' }
        );
      }

      const userId = tokenRows[0].user_id;

      const { rows: userRows } = await tx.query(
        `UPDATE users
         SET password_hash = $1
         WHERE id = $2 AND status = 'ACTIVE'
         RETURNING id`,
        [passwordHash, userId]
      );

      if (!userRows.length) {
        throw Object.assign(new Error('Account is not active.'), {
          statusCode: 400,
          code: 'INVALID_ACCOUNT_STATE',
        });
      }

      // Revoke existing active sessions for security
      await tx.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    });

    return { message: 'Your password has been updated. You may now sign in.' };
  });
}