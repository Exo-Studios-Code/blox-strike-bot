/**
 * src/bot/matchEngineRegistry.ts
 *
 * Holds the single live MatchEngine instance so any module can reach it
 * without importing index.ts (which would create a circular dependency).
 *
 * Usage:
 *   // In index.ts (ClientReady):
 *   import { setMatchEngine } from './bot/matchEngineRegistry';
 *   setMatchEngine(new MatchEngine(guild));
 *
 *   // Anywhere else (e.g. MatchmakingWorker, button handlers):
 *   import { getMatchEngine } from './bot/matchEngineRegistry';
 *   const engine = getMatchEngine();
 *   if (!engine) throw new Error('MatchEngine not initialised yet');
 */

import type { MatchEngine } from '../engines/match/MatchEngine';

let _instance: MatchEngine | null = null;

export function setMatchEngine(engine: MatchEngine): void {
  _instance = engine;
}

export function getMatchEngine(): MatchEngine | null {
  return _instance;
}
