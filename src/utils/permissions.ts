import { GuildMember } from 'discord.js';
import { GUILD_CONFIG } from '../config/bot';

export function isAdmin(member: GuildMember): boolean {
  return (
    member.permissions.has('Administrator') ||
    (GUILD_CONFIG.adminRoleId !== '' && member.roles.cache.has(GUILD_CONFIG.adminRoleId))
  );
}

export function isModerator(member: GuildMember): boolean {
  return (
    isAdmin(member) ||
    (GUILD_CONFIG.modRoleId !== '' && member.roles.cache.has(GUILD_CONFIG.modRoleId))
  );
}

export function hasVerifiedRole(member: GuildMember): boolean {
  if (!GUILD_CONFIG.verifiedRoleId) return true; // If not configured, skip check
  return member.roles.cache.has(GUILD_CONFIG.verifiedRoleId);
}
