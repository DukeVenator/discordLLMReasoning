/**
 * @fileoverview Main entry point for the LLMcordTS Discord bot.
 * Initializes the bot, sets up logging, handles global errors, and starts the bot.
 */
import { logger } from './core/logger'; // Import the exported logger instance
import { LLMCordBot } from './core/LLMCordBot'; // Import the bot class


async function main() {
  logger.info('Starting LLMCordTS Bot...');

/**
 * Main application function.
 * Initializes and runs the LLMCordBot instance.
 * Handles critical startup errors.
 */
  try {
    // Instantiate the bot
    const bot = new LLMCordBot();

    // Initialize the bot (loads config, sets up clients, registers handlers)
    await bot.initialize(); // This now handles config loading internally

    // Run the bot (logs in to Discord)
    await bot.run();

    logger.info('LLMCordTS Bot is running.');

    // --- Graceful Shutdown Handling ---
    const shutdownHandler = async (signal: string) => {
      logger.info(`Received ${signal}. Initiating graceful shutdown...`);
      await bot.shutdown();
      process.exit(0); // Exit cleanly after shutdown
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));


  } catch (error) {
    logger.error('Error during bot startup:', error);
    process.exit(1); // Exit if initialization or login fails
  }
}

// --- Global Error Handling ---
process.on('uncaughtException', (error) => {
  logger.error('Unhandled Exception:', error);
  // Consider more graceful shutdown logic here
/**
 * Handles uncaught exceptions globally.
 * Logs the error and exits the process to prevent an unstable state.
 * @param {Error} error - The uncaught exception.
 */
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => { // Prefix promise with _ to indicate it's unused
  logger.error('Unhandled Rejection detected. Attempting to log details...');
  try {
    // Attempt to log reason, converting to string if it's complex
    const reasonString = (reason instanceof Error) ? reason.stack : String(reason);
    logger.error('Unhandled Rejection Reason:', reasonString);
    // Optionally log promise details if helpful, but keep it simple for now
    // logger.error('Unhandled Rejection Promise:', promise);
  } catch (logError) {
    logger.error('Failed to log unhandled rejection details:', logError);
  }
  // Consider more graceful shutdown logic here
  process.exit(1);
/**
 * Handles unhandled promise rejections globally.
 * Logs the reason and the promise, then exits the process.
 * @param {*} reason - The reason for the rejection (can be any type).
 * @param {Promise<any>} promise - The promise that was rejected.
 */
});

// --- Run the application ---
main(); // No need for .catch here as main handles its errors