/**
 * Mission Control Bot - Main Entry Point
 *
 * Starts both Telegram and Discord bots, handles graceful shutdown.
 */

import { startTelegramBot, stopTelegramBot } from './telegram';
import { startDiscordBot, stopDiscordBot, discordClient, cleanupDone } from './discord';
import { startDeadlineChecker, stopDeadlineChecker } from './deadline-checker';
import { startStatusServer, stopStatusServer, setDiscordClient, setTelegramRunning } from './status-server';

console.log('='.repeat(50));
console.log('  Mission Control Bot');
console.log('  Version: 3.0.0');
console.log('='.repeat(50));
console.log('');
console.log('[Main] DEBUG: Starting initialization...');

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Main] Received ${signal}, shutting down...`);

  try {
    stopStatusServer();
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
    setDiscordClient(discordClient);
    console.log('[Main] DEBUG: Discord bot started');

    // Start Telegram bot (this runs indefinitely via polling)
    // We don't await it because start() never resolves
    startTelegramBot().catch(err => {
      console.error('[Main] Telegram bot error:', err);
      setTelegramRunning(false);
    });
    setTelegramRunning(true);

    console.log('[Main] DEBUG: Telegram bot starting (long-polling)');

    // Wait for startup cleanup to finish before starting deadline checker
    // This prevents the deadline checker from archiving threads mid-cleanup
    await cleanupDone;
    console.log('[Main] DEBUG: Startup cleanup complete');

    // Start deadline checker (for Google Sheets export)
    startDeadlineChecker();

    // Start status dashboard HTTP server
    startStatusServer();

    console.log('\n[Main] All services initialized!');
    console.log('[Main] Press Ctrl+C to stop.\n');

  } catch (error) {
    console.error('[Main] Failed to start services:', error);
    process.exit(1);
  }
}

// Run
main();
