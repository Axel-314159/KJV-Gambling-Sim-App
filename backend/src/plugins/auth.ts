import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/pool.js';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: 'PLAYER' | 'MODERATOR' | 'ADMIN';
  status: 'PENDING_APPROVAL' | 'AWAITING_PASSWORD' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  suspendedUntil: string | null;
  maxBetOverride: number | null;
  walletBalance: number;
  createdAt: string;
  autoRegister: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: AuthUser | null;
  }
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function registerAuthHooks(app: FastifyInstance) {
  app.decorateRequest('currentUser', null);

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const rawSid = req.cookies?.sid;
    if (!rawSid) return;

    const sidHash = hashToken(rawSid);
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.suspended_until,
              u.max_bet_override, u.wallet_balance, u.created_at, u.auto_register
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sidHash]
    );

    if (!rows.length) return;
    const u = rows[0];

    // Automatically lift expired temporary suspensions
    if (u.status === 'SUSPENDED' && u.suspended_until && new Date(u.suspended_until) <= new Date()) {
      await pool.query(`UPDATE users SET status = 'ACTIVE', suspended_until = NULL WHERE id = $1`, [u.id]);
      u.status = 'ACTIVE';
      u.suspended_until = null;
    }

    req.currentUser = {
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      status: u.status,
      suspendedUntil: u.suspended_until ? new Date(u.suspended_until).toISOString() : null,
      maxBetOverride: u.max_bet_override,
      walletBalance: u.wallet_balance,
      createdAt: new Date(u.created_at).toISOString(),
      autoRegister: u.auto_register
    };
  });
}

export async function requireActivePlayer(req: FastifyRequest, reply: FastifyReply) {
  const user = req.currentUser;
  if (!user) {
    return reply.status(401).send({ code: 'UNAUTHENTICATED', message: 'Please sign in.' });
  }
  if (user.status === 'DEACTIVATED') {
    return reply.status(403).send({ code: 'DEACTIVATED', message: 'Your account has been deactivated.' });
  }
  if (user.status === 'SUSPENDED') {
    return reply.status(403).send({
      code: 'SUSPENDED',
      message: `Account suspended until ${user.suspendedUntil}.`,
    });
  }
  if (user.status !== 'ACTIVE') {
    return reply.status(403).send({ code: 'INACTIVE', message: 'Account activation incomplete.' });
  }
}

export function requireRole(roles: Array<'MODERATOR' | 'ADMIN'>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireActivePlayer(req, reply);
    if (reply.sent) return;
    if (!req.currentUser || !roles.includes(req.currentUser.role as 'MODERATOR' | 'ADMIN')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions.' });
    }
  };
}