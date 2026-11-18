export const GERAHS_PER_SHEKEL = 20;

export function toGerahs(shekels: number, gerahs = 0): number {
  return Math.trunc(shekels) * GERAHS_PER_SHEKEL + Math.trunc(gerahs);
}

export function splitGerahs(totalGerahs: number | bigint): {
  isNegative: boolean;
  shekels: number;
  gerahs: number;
} {
  const n = BigInt(totalGerahs);
  const isNegative = n < 0n;
  const abs = isNegative ? -n : n;
  const shekels = Number(abs / 20n);
  const gerahs = Number(abs % 20n);
  return { isNegative, shekels, gerahs };
}

export function formatCurrency(totalGerahs: number | bigint, showZeroGerahs = false): string {
  const { isNegative, shekels, gerahs } = splitGerahs(totalGerahs);
  const sign = isNegative ? '-' : '';
  return `${sign}${shekels.toLocaleString()} SHK, ${gerahs} GRH`;
}

export function formatSignedCurrency(totalGerahs: number | bigint): string {
  const n = BigInt(totalGerahs);
  const formatted = formatCurrency(n);
  return n > 0n ? `+${formatted}` : formatted;
}