/**
 * @fileoverview Defines the core interfaces and types for interacting with Large Language Model (LLM) providers.
 * Includes definitions for chat messages (potentially multimodal), streamed response chunks,
 * finish reasons, and the base provider interface (`BaseProvider`).
 */
// LLMcordTS/src/providers/baseProvider.ts
import type { ToolDefinition, ToolCallRequest } from '../types/tools';

/**
 * Optional parameters that can be passed to control LLM generation.
 */
export interface GenerationOptions {
  /** Overrides the provider's default temperature. */
  temperature?: number;
  /** Overrides the provider's default max output tokens. */
  maxOutputTokens?: number;
  /** Optional: Override the provider's default model for this specific request. */
  model?: string;
  // Add other common generation parameters here if needed in the future
  // e.g., topP?: number;
  /** An array of tools the model may call. */
  tools?: ToolDefinition[];
  // e.g., stopSequences?: string[];
}

/**
 * Represents a single message in the chat history, potentially multimodal.
 */
export interface ChatMessageContentPartText {
    type: 'text';
    text: string;
}

/** Represents an image provided via URL (less common now). */
export interface ChatMessageContentPartImageUrl {
    type: 'image_url';
    image_url: {
        url: string;
        // detail?: 'low' | 'high' | 'auto'; // Optional detail field if needed later
    };
}

/** Represents an image provided as base64 encoded data. */
export interface ChatMessageContentPartImageBase64 {
    type: 'image'; // Common type name used by APIs like Anthropic
    source: {
        type: 'base64';
        media_type: string; // e.g., 'image/jpeg', 'image/png'
        data: string; // The base64 encoded image data
    };
}

/** Represents a function call requested by the assistant. */
export interface ChatMessageContentPartFunctionCall {
    type: 'functionCall'; // Use a distinct type name
    functionCall: { // Structure mirroring Gemini's FunctionCall, but using our internal types/names
        name: string;
        args: Record<string, unknown>;
        // We don't need the 'id' here as it's generated during the request phase
    };
}

/** Union type for different parts of a multimodal message content. */
export type ChatMessageContentPart =
    | ChatMessageContentPartText
    | ChatMessageContentPartImageUrl // Keep for potential future use or compatibility
    | ChatMessageContentPartImageBase64 // Add the new base64 image type
    | ChatMessageContentPartFunctionCall; // Add the new function call type

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'; // Add 'tool' role
  /** The content of the message. Can be a simple string or an array for multimodal input. */
  content: string | ChatMessageContentPart[];
  /** An optional name for the participant. Used by some providers (e.g., OpenAI) for function calling or identifying users. */
  name?: string;
  /** Optional: The ID of the tool call this message is responding to (only for role: 'tool'). */
  tool_call_id?: string;
  /** Optional: The name of the tool being called (only for role: 'tool'). */
  tool_name?: string;
  // Removed tool_calls?: ToolCallRequest[]; - This will now be part of the content array
}

/**
 * Represents a chunk of the streamed response from the LLM.
 */
export interface StreamChunk {
  /** Text content of the chunk, if any. */
  content?: string;
  /** Tool call requests in this chunk, if any. */
  toolCalls?: ToolCallRequest[];
  /** Indicates if this is the last chunk of the response. */
  isFinal: boolean;
  /** Reason why the generation finished (only relevant if isFinal is true). */
  finishReason?: FinishReason;
  // Add other potential fields like usage stats if available in chunks
}

/**
 * Possible reasons for the LLM generation to finish.
 */
export type FinishReason =
  | 'stop' // Natural end of generation
  | 'length' // Reached maximum token limit
  | 'content_filter' // Content was filtered
  | 'tool_calls' // Model decided to call tools (if implemented)
  | 'error' // An error occurred
  | 'unknown'; // Unknown reason

/**
 * Common interface for all LLM providers.
 */
export interface BaseProvider {
  // Removed hardcoded supportsVision flag - replaced by supportsVision() method

  /**
   * Checks if the currently configured provider and model support vision (image) inputs.
   * @returns True if vision is supported, false otherwise.
   */
  supportsVision(): boolean;

  /**
   * Checks if the provider supports tool/function calling.
   * @returns True if tool calling is supported, false otherwise.
   */
  supportsTools(): boolean;

  /**
   * Checks if the provider natively supports a separate system prompt.
   * Some providers require the system prompt to be merged into the first user message.
   * @returns True if a separate system prompt is supported, false otherwise.
   */
  supportsSystemPrompt(): boolean;

  /**
   * Checks if the provider supports including usernames in the message history.
   * @returns True if usernames are supported, false otherwise.
   */
  supportsUsernames(): boolean;

  /**
   * Checks if the provider supports streaming responses.
   * While the interface requires `generateStream`, this allows checking
   * if streaming is *actually* supported or just a fallback implementation.
   * @returns True if streaming is natively supported, false otherwise.
   */
  supportsStreaming(): boolean;


  /**
   * Generates a response stream based on the provided message history and system prompt.
   *
   * @param messages - An array of ChatMessage objects representing the conversation history.
   * @param systemPrompt - An optional system prompt string.
   * @param options - Optional parameters to control the generation (e.g., temperature, max tokens).
   * @returns An async generator yielding StreamChunk objects.
   */
  generateStream(
    messages: ChatMessage[],
    systemPrompt?: string,
    options?: GenerationOptions, // Add the new options parameter
  ): AsyncGenerator<StreamChunk, void, undefined>;

  /**
   * Optional: A method to get provider-specific details or capabilities.
   */
  getProviderInfo?(): Record<string, any>;
}