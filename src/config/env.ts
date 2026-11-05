import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Natvrdo zaměříme cestu k .env v kořenové složce projektu
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Discord Token chybí v .env"),
  DISCORD_CLIENT_ID: z.string().min(1, "Client ID chybí v .env"),
  DISCORD_GUILD_ID: z.string().min(1, "Guild ID chybí v .env"),
  ADMIN_ROLE_ID: z.string().optional(),
  MATCHES_CATEGORY_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, "Database URL chybí v .env"),
  REDIS_URL: z.string().min(1, "Redis URL chybí v .env"),
});

// Zkusíme to vyparsovat a v případě chyby vypíšeme, co přesně v process.env je
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Chyba při načítání proměnných prostředí!');
  console.error('Detaily chyb:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
