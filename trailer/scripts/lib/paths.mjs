import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUILD = join(ROOT, 'build');
export const WEB = join(ROOT, 'web');
