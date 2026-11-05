export const LEVEL_BRACKETS = [
  { level: 1,  minElo: 0,    maxElo: 799,       name: 'Iron',        color: 0x6b7280, emoji: '⚙️'  },
  { level: 2,  minElo: 800,  maxElo: 999,       name: 'Bronze',      color: 0x92400e, emoji: '🥉'  },
  { level: 3,  minElo: 1000, maxElo: 1149,      name: 'Silver',      color: 0x9ca3af, emoji: '🥈'  },
  { level: 4,  minElo: 1150, maxElo: 1299,      name: 'Gold',        color: 0xf59e0b, emoji: '🥇'  },
  { level: 5,  minElo: 1300, maxElo: 1449,      name: 'Platinum',    color: 0x06b6d4, emoji: '💎'  },
  { level: 6,  minElo: 1450, maxElo: 1599,      name: 'Diamond',     color: 0x3b82f6, emoji: '🔷'  },
  { level: 7,  minElo: 1600, maxElo: 1749,      name: 'Master',      color: 0x8b5cf6, emoji: '🏆'  },
  { level: 8,  minElo: 1750, maxElo: 1899,      name: 'Grandmaster', color: 0xec4899, emoji: '👑'  },
  { level: 9,  minElo: 1900, maxElo: 2099,      name: 'Legendary',   color: 0xef4444, emoji: '🔥'  },
  { level: 10, minElo: 2100, maxElo: Infinity,  name: 'Blox Elite',  color: 0xff6b00, emoji: '⚡'  },
] as const;

export type LevelBracket = typeof LEVEL_BRACKETS[number];

export function getLevelFromElo(elo: number): LevelBracket {
  return (
    (LEVEL_BRACKETS as readonly LevelBracket[]).find(
      (b) => elo >= b.minElo && elo <= b.maxElo
    ) ?? LEVEL_BRACKETS[0]
  );
}

export function getLevelBracket(level: number): LevelBracket {
  return (
    (LEVEL_BRACKETS as readonly LevelBracket[]).find((b) => b.level === level) ??
    LEVEL_BRACKETS[0]
  );
}

export const WIN_RATE_DISPLAY = (wins: number, total: number): string => {
  if (total === 0) return '0%';
  return `${Math.round((wins / total) * 100)}%`;
};

export const KD_DISPLAY = (wins: number, losses: number): string => {
  if (losses === 0) return wins > 0 ? '∞' : '0.00';
  return (wins / losses).toFixed(2);
};
