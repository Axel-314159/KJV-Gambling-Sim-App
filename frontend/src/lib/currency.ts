export const GERAHS_PER_SHEKEL = 20;

export function toGerahs(shekels: number, gerahs = 0): number {
  return Math.trunc(shekels) * GERAHS_PER_SHEKEL + Math.trunc(gerahs);
}

export function splitGerahs(totalGerahs: number | bigint | null | undefined): {
  isNegative: boolean;
  shekels: number;
  gerahs: number;
} {
  const n = BigInt(totalGerahs ?? 0);
  const isNegative = n < 0n;
  const abs = isNegative ? -n : n;
  const shekels = Number(abs / 20n);
  const gerahs = Number(abs % 20n);
  return { isNegative, shekels, gerahs };
}

export function formatCurrency(totalGerahs: number | bigint | null | undefined, _showZeroGerahs = false): string {
  const { isNegative, shekels, gerahs } = splitGerahs(totalGerahs);
  const sign = isNegative ? '-' : '';
  return `${sign}${shekels.toLocaleString()} SHK, ${gerahs} GRH`;
}

export function formatSignedCurrency(totalGerahs: number | bigint | null | undefined): string {
  const n = BigInt(totalGerahs ?? 0);
  const formatted = formatCurrency(n);
  return n > 0n ? `+${formatted}` : formatted;
}