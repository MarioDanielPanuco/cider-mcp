import type { z } from 'zod';
import type { CiderClient } from '../cider-client.js';
import type { AppleMusicClient } from '../apple-client.js';

export interface Deps {
  cider: CiderClient;
  apple: AppleMusicClient;
}

export interface ToolDef<S extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (args: z.infer<S>, deps: Deps) => Promise<unknown>;
}

/** Identity helper that pins generic inference so `args` is typed inside handlers. */
export function defineTool<S extends z.ZodObject<any>>(def: ToolDef<S>): ToolDef<S> {
  return def;
}
