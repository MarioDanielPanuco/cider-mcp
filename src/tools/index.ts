import { playbackTools } from './playback.js';
import { queueTools } from './queue.js';
import { libraryTools } from './library.js';
import { discoveryTools } from './discovery.js';
import { playlistTools } from './playlists.js';
import type { ToolDef } from './types.js';

/**
 * Order is part of the contract: MCP 2026-07-28 asks servers to return tools
 * from tools/list deterministically so clients can cache the list and keep
 * prompt-cache hits stable. Append new tools at the end of their group.
 */
export const allTools: readonly ToolDef[] = Object.freeze([
  ...playbackTools,
  ...queueTools,
  ...libraryTools,
  ...discoveryTools,
  ...playlistTools,
]);
