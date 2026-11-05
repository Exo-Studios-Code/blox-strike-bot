import { JoinMethod, QueueType } from '@prisma/client';

export interface QueueEntry {
  sessionId: string;
  playerIds: string[];
  averageElo: number;
  type: QueueType;
  queuedAt: number;
  joinMethod?: JoinMethod;
  privateServerUrl?: string;
  inviteCode?: string;
  robloxUsername?: string;
  joinInstructions?: string;
  backupContact?: string;
}

export interface JoinInfo {
  joinMethod?: JoinMethod;
  privateServerUrl?: string;
  inviteCode?: string;
  robloxUsername?: string;
  joinInstructions?: string;
  backupContact?: string;
}

export interface QueueStatusResult {
  count: number;
  entries: QueueEntry[];
}
