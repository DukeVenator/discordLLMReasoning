import { Message } from 'discord.js'; // Removed unused Collection
import { ChatMessageContentPartImageBase64, ChatMessage } from '../providers/baseProvider'; // Assuming baseProvider exports ChatMessage
// Removed unused Config, Logger, BaseProvider imports

/**
 * Represents the processed data for a single message in the conversation history.
 * Used for caching and building the final history for the LLM.
 * Renamed from MessageNode.
 */
export interface IMessageNode {
    /** The processed text content of the message. */
    text: string | null;
    /**
     * Array of image objects formatted for the LLM provider using base64 encoding.
     */
    images: ChatMessageContentPartImageBase64[];
    /** The role of the message author ('user' or 'assistant'). */
    role: 'user' | 'assistant';
    /** The Discord ID of the user who sent the message (if role is 'user'). */
    userId: string | null;
    /** Flag indicating if the message had unsupported attachments that were ignored. */
    hasBadAttachments: boolean;
    /** Flag indicating if fetching the parent message in the reply chain failed. */
    fetchParentFailed: boolean;
    /** The fetched discord.js Message object for the parent message, if applicable. */
    parentMessage: Message | null;
    /** The original message ID this node represents. */
    messageId: string;
}

/**
 * Represents the structured conversation history ready to be sent to the LLM.
 * This might be an array of LLM-specific message objects.
 */
export type IMessageHistory = ChatMessage[]; // Using ChatMessage from baseProvider as a likely structure

/**
 * Represents a warning generated during message processing or history building.
 */
export interface IWarning {
    type: 'BadAttachment' | 'FetchParentFailed' | 'HistoryTruncation' | 'Generic'; // Example types
    message: string;
    /** Optional reference to the message ID causing the warning */
    messageId?: string;
}

/**
 * Interface for the MessageProcessor class responsible for handling
 * incoming messages and constructing the conversation history.
 */
export interface IMessageProcessor {
    /**
     * Processes a single incoming Discord message into an IMessageNode.
     * @param message The raw Discord message.
     * @returns A promise resolving to the processed message node.
     */
    processMessageNode(message: Message): Promise<IMessageNode>;

    /**
     * Builds the message history array in the format expected by the LLM provider.
     * Traverses the reply chain starting from the `latestMessage`.
     * @param latestMessage - The most recent discord.js Message object in the conversation chain.
     * @returns A promise resolving to an object containing the built history and any warnings generated.
     */
    buildMessageHistory(
        latestMessage: Message
    ): Promise<{ history: IMessageHistory; warnings: IWarning[] }>;
}