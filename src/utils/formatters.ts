import { getLevelFromElo } from './constants';

export function formatElo(elo: number): string {
  const bracket = getLevelFromElo(elo);
  return `${bracket.emoji} **${elo}** (${bracket.name})`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  return formatDuration(Math.abs(diff)) + (diff < 0 ? ' from now' : ' ago');
}

export function formatWinRate(wins: number, total: number): string {
  if (total === 0) return '0.0%';
  return `${((wins / total) * 100).toFixed(1)}%`;
}

export function formatKD(wins: number, losses: number): string {
  if (losses === 0) return wins > 0 ? '∞' : '0.00';
  return (wins / losses).toFixed(2);
}

export function formatEloChange(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

export function formatMatchId(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function pluralize(count: number, word: string, plural?: string): string {
  return count === 1 ? `${count} ${word}` : `${count} ${plural ?? word + 's'}`;
}
