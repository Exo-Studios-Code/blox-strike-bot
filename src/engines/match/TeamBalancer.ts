// ─────────────────────────────────────────────────────────────────────────────
// TeamBalancer.ts
// Splits 10 players into two balanced 5-player teams using snake draft by MMR.
// Fully customized for FACEIT Elo & Level visual aesthetics.
// ─────────────────────────────────────────────────────────────────────────────

export interface TeamPlayer {
  discordId: string;
  mmr: number;
  elo: number; // Přidáno: Potřebujeme sledovat veřejné Elo pro správný Faceit displej
  robloxUsername: string;
}

export interface BalancedTeams {
  teamA: TeamPlayer[];
  teamB: TeamPlayer[];
  teamAAvgMmr: number;
  teamBAvgMmr: number;
  mmrDifference: number;
}

// Pomocná funkce pro zjištění Faceit Levelu v rámci balanceru
function getFaceitLevel(elo: number): number {
  if (elo <= 800) return 1;
  if (elo <= 950) return 2;
  if (elo <= 1100) return 3;
  if (elo <= 1250) return 4;
  if (elo <= 1400) return 5;
  if (elo <= 1550) return 6;
  if (elo <= 1700) return 7;
  if (elo <= 1850) return 8;
  if (elo <= 2000) return 9;
  return 10;
}

export class TeamBalancer {
  /**
   * Přijme přesně 10 hráčů a rozdělí je na dva vybalancované týmy po 5.
   * Algoritmus: Seřadí hráče sestupně podle skrytého MMR a rozhází je systémem:
   * Tým A: 1., 4., 5., 8., 9. nejlepší hráč
   * Tým B: 2., 3., 6., 7., 10. nejlepší hráč
   */
  static balance(players: TeamPlayer[]): BalancedTeams {
    if (players.length !== 10) {
      throw new Error(
        `TeamBalancer requires exactly 10 players, received ${players.length}`
      );
    }

    // Seřazení hráčů podle interního MMR od nejlepšího po nejhoršího
    const sorted = [...players].sort((a, b) => b.mmr - a.mmr);

    const teamA: TeamPlayer[] = [];
    const teamB: TeamPlayer[] = [];

    // Oficiální Snake Draft vzorec indexů (0 až 9)
    const SNAKE_DRAFT = ["A", "B", "B", "A", "A", "B", "B", "A", "A", "B"] as const;

    for (let i = 0; i < sorted.length; i++) {
      if (SNAKE_DRAFT[i] === "A") {
        teamA.push(sorted[i]);
      } else {
        teamB.push(sorted[i]);
      }
    }

    const avg = (arr: TeamPlayer[]) =>
      Math.round(arr.reduce((sum, p) => sum + p.mmr, 0) / arr.length);

    const teamAAvgMmr = avg(teamA);
    const teamBAvgMmr = avg(teamB);
    const mmrDifference = Math.abs(teamAAvgMmr - teamBAvgMmr);

    return { teamA, teamB, teamAAvgMmr, teamBAvgMmr, mmrDifference };
  }

  /**
   * Zformátuje soupisku týmu do embedu na Discord jako profesionální Faceit tabulku.
   */
  static formatRoster(team: TeamPlayer[], _label?: string): string {
    return team
      .sort((a, b) => b.elo - a.elo) // Na soupisce řadíme viditelně podle nejvyššího ELO
      .map((p, i) => {
        const level = getFaceitLevel(p.elo);
        
        // Faceit barevné rozlišení levelů pomocí emoji teček
        let levelEmoji = "⚪"; // Level 1-3 (Low tier)
        if (level === 10) levelEmoji = "🔴";     // Level 10 (Pro tier)
        else if (level >= 8) levelEmoji = "orange_circle:"; // Level 8-9 (High tier)
        else if (level >= 4) levelEmoji = "🟢";     // Level 4-7 (Mid tier)

        // Výsledek: "1. 🟢 @Uzivatel — RobloxName (Level 3 | 1000 ELO)"
        return `\`${i + 1}.\` ${levelEmoji} <@${p.discordId}> — \`${p.robloxUsername}\` (Lvl ${level} • \`${p.elo} ELO\`)`;
      })
      .join("\n");
  }
}