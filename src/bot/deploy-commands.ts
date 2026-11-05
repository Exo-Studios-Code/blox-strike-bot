import { REST, Routes } from 'discord.js';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const commands: any[] = [];
const commandsPath = path.join(__dirname, '../commands');

if (fs.existsSync(commandsPath)) {
  const commandFolders = fs.readdirSync(commandsPath);
  
  for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
    
    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      const commandModule = require(filePath);
      const command = commandModule.default || commandModule;
      
      if (command && command.data && command.execute) {
        commands.push(command.data.toJSON());
      }
    }
  }
}

const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

(async () => {
  try {
    logger.info(`Zahajuji registraci ${commands.length} příkazů na Discord API...`);

    // Registrujeme příkazy pro konkrétní server (Guild), což se projeví OKAMŽITĚ
    const data: any = await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
      { body: commands },
    );

    logger.info(`✅ Úspěšně zaregistrováno ${data.length} příkazů pro server!`);
  } catch (error: any) {
    logger.error('Selhalo odesílání příkazů na Discord', {
      message: error?.message,
      stack: error?.stack,
      raw: error
    });
  }
})();
