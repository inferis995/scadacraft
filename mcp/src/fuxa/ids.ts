/** Identifier helpers matching the ScadaCraft client (Utils.getGUID / getShortGUID). */
import { randomBytes } from 'node:crypto';

const hex = (n: number): string => randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);

/** Same shape as Utils.getGUID(prefix): 8 hex, '-', 4 hex, '4', 3 hex */
export function guid(prefix = ''): string {
  return `${prefix}${hex(8)}-${hex(4)}4${hex(3)}`;
}

export const DEVICE_PREFIX = 'd_';
export const TAG_PREFIX = 't_';
export const SERVER_DEVICE_ID = '0';
