/**
 * @fileoverview Defines TypeScript interfaces related to Discord interactions,
 * specifically for managing bot responses.
 */

import { Message } from 'discord.js';
import { Config } from './config'; // Assuming config types are in the same directory
import { Logger } from '../core/logger'; // Adjust path as needed

/**
 * Represents the core functionalities for managing a Discord response lifecycle.
 * This includes sending initial placeholders, updating with streamed content,
 * handling final formatting, and managing errors.
 */
export interface IResponseManager {
  /**
   * Sends the initial response message (e.g., "Thinking...").
   * This message will be subsequently edited with the actual content.
   * @returns {Promise<void>} A promise that resolves when the initial message is sent.
   */
  sendInitialResponse(): Promise<void>;

  /**
   * Updates the response message with a new chunk of content.
   * Handles streaming updates, message splitting/truncation, and formatting.
   * @param {string} chunk - The next piece of content to add to the response.
   * @param {boolean} isFinal - Indicates if this is the last chunk of the response.
   * @returns {Promise<void>} A promise that resolves when the message is updated.
   */
  updateResponse(chunk: string, isFinal: boolean): Promise<void>;

  /**
   * Handles errors that occur during the response sending or updating process.
   * This could involve logging the error and potentially sending an error message
   * to the user.
   * @param {Error} error - The error object that occurred.
   * @returns {Promise<void>} A promise that resolves when the error has been handled.
   */
  handleError(error: Error): Promise<void>;

  /**
   * Optional: Cleans up any resources or state associated with the response manager,
   * such as cancelling timers or removing listeners.
   * @returns {Promise<void>}
   */
  // cleanup?(): Promise<void>; // Consider if cleanup logic is needed
}

/**
 * Options required to instantiate a ResponseManager.
 */
export interface ResponseManagerOptions {
  /** The original Discord message that triggered the bot's response. */
  originalMessage: Message;
  /** The application configuration object. */
  config: Config;
  /** The logger instance for logging messages and errors. */
  logger: Logger;
  /** The initial content for the placeholder message (e.g., "Thinking..."). */
  initialContent?: string;
}

// Re-export Message type for convenience if needed elsewhere,
// or define a more specific internal type if abstraction is desired.
export { Message as DiscordMessage };