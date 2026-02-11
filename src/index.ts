/**
 * Mission Control Bot - Main Entry Point
 *
 * Starts both Telegram and Discord bots, handles graceful shutdown.
 */

import { startTelegramBot, stopTelegramBot } from './telegram';
import { startDiscordBot, stopDiscordBot } from './discord';
import { startDeadlineChecker, stopDeadlineChecker } from './deadline-checker';

console.log('='.repeat(50));
console.log('  Mission Control Bot');
console.log('  Version: 2.0.0');
console.log('='.repeat(50));
console.log('');
console.log('[Main] DEBUG: Starting initialization...');

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Main] Received ${signal}, shutting down...`);

  try {
    stopDeadlineChecker();
    stopTelegramBot();
    await stopDiscordBot();
    console.log('[Main] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[Main] Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/**
 * Main function - start all bots
 *
 * Note: Discord bot is started first and awaited.
 * Telegram bot uses long-polling which runs indefinitely,
 * so we start it but don't await it.
 */
async function main(): Promise<void> {
  console.log('[Main] Starting services...\n');

  try {
    // Start Discord bot first (quick - just login)
    await startDiscordBot();
    console.log('[Main] DEBUG: Discord bot started');

    // Start Telegram bot (this runs indefinitely via polling)
    // We don't await it because start() never resolves
    startTelegramBot().catch(err => {
      console.error('[Main] Telegram bot error:', err);
    });

    console.log('[Main] DEBUG: Telegram bot starting (long-polling)');

    // Start deadline checker (for Google Sheets export)
    startDeadlineChecker();

    console.log('\n[Main] All services initialized!');
    console.log('[Main] Press Ctrl+C to stop.\n');

  } catch (error) {
    console.error('[Main] Failed to start services:', error);
    process.exit(1);
  }
}

// Run
main();
