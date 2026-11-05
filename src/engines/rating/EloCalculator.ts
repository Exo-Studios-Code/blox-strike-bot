export class EloCalculator {
  /**
   * K-factor based on level and games played.
   * Higher K = more volatile (bigger swings).
   */
  static getKFactor(level: number, totalMatches: number): number {
    if (totalMatches < 10) return 40; // Placement volatility
    if (level <= 3) return 32;        // New players
    if (level <= 6) return 24;        // Mid players
    if (level <= 8) return 20;        // High players
    return 16;                         // Elite players
  }

  /**
   * Expected score — probability of winning based on Elo difference.
   */
  static expectedScore(playerElo: number, opponentAvgElo: number): number {
    return 1 / (1 + Math.pow(10, (opponentAvgElo - playerElo) / 400));
  }

  /**
   * Calculate new visible Elo after a match.
   * Enforces minimum gain on win (+5) and minimum loss on defeat (-5).
   */
  static calculateNewElo(
    currentElo: number,
    opponentAvgElo: number,
    won: boolean,
    drew: boolean,
    level: number,
    totalMatches: number,
    winStreak: number = 0
  ): { newElo: number; delta: number } {
    const K = this.getKFactor(level, totalMatches);
    const E = this.expectedScore(currentElo, opponentAvgElo);
    const S = won ? 1 : drew ? 0.5 : 0;

    let delta = Math.round(K * (S - E));

    // Win streak bonus
    if (won) {
      const bonus = this.getStreakBonus(winStreak);
      delta += bonus;
      delta = Math.max(delta, 5); // Minimum +5 on win
    } else if (!drew) {
      delta = Math.min(delta, -5); // Minimum -5 on loss
    }

    // Never drop below 0
    const newElo = Math.max(0, currentElo + delta);
    const actualDelta = newElo - currentElo;

    return { newElo, delta: actualDelta };
  }

  /**
   * Calculate hidden MMR — more sensitive, no floor restriction.
   */
  static calculateNewMMR(
    currentMMR: number,
    opponentAvgMMR: number,
    won: boolean,
    drew: boolean
  ): { newMMR: number; delta: number } {
    const K = 40; // Always high K for MMR
    const E = this.expectedScore(currentMMR, opponentAvgMMR);
    const S = won ? 1 : drew ? 0.5 : 0;
    const delta = Math.round(K * (S - E));
    const newMMR = Math.max(0, currentMMR + delta);
    return { newMMR, delta: newMMR - currentMMR };
  }

  /**
   * Win streak Elo bonus.
   */
  static getStreakBonus(winStreak: number): number {
    if (winStreak < 3) return 0;
    if (winStreak < 5) return 5;
    if (winStreak < 8) return 10;
    if (winStreak < 12) return 15;
    return 20;
  }

  /**
   * Calculate starting Elo from placement match performance.
   */
  static calculatePlacementElo(wins: number, losses: number): number {
    const total = wins + losses;
    if (total === 0) return 1000;
    const winRate = wins / total;
    const baseElo = 800 + Math.round(winRate * 600); // Range: 800–1400
    return Math.min(Math.max(baseElo, 800), 1400);
  }
}
