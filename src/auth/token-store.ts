/**
 * File-based OAuth token persistence.
 *
 * Tokens are stored as JSON at TOKEN_STORE_PATH (default: .ghl-tokens.json
 * in the working directory). The file is gitignored and never committed.
 */

import fs from 'fs';
import path from 'path';
import { GHLTokens } from './oauth.js';

export class TokenStore {
  readonly storePath: string;

  constructor() {
    this.storePath =
      process.env.TOKEN_STORE_PATH ||
      path.join(process.cwd(), '.ghl-tokens.json');
  }

  load(): GHLTokens | null {
    try {
      if (!fs.existsSync(this.storePath)) return null;
      return JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as GHLTokens;
    } catch {
      return null;
    }
  }

  save(tokens: GHLTokens): void {
    fs.writeFileSync(this.storePath, JSON.stringify(tokens, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  clear(): void {
    if (fs.existsSync(this.storePath)) fs.unlinkSync(this.storePath);
  }
}
