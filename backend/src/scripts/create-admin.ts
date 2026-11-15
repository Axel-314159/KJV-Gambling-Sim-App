import { hash } from '@node-rs/argon2';
import { pool, withTransaction } from '../db/pool.js';

async function main() {
  const [, , username, email, password] = process.argv;

  if (!username || !email || !password || password.length < 10) {
    console.error('Usage: npx tsx src/scripts/create-admin.ts <username> <email> <password_min_10_chars>');
    process.exit(1);
  }

  const passwordHash = await hash(password);

  await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO users (username, email, password_hash, role, status, wallet_balance)
       VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE', 1000)
       RETURNING id, username, role`,
      [username.trim(), email.trim().toLowerCase(), passwordHash]
    );

    await tx.query(
      `INSERT INTO wallet_ledger (user_id, entry_type, amount, balance_after)
       VALUES ($1, 'INITIAL_GRANT', 1000, 1000)`,
      [rows[0].id]
    );

    console.log(`Created active ADMIN account: ${rows[0].username} (${rows[0].id}) with 1,000 Shekels.`);
  });

  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});