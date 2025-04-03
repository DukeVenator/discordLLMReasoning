# LLM Provider Integration

This document describes how LLMcordTS integrates with various Large Language Model (LLM) providers.

## Overview

The bot uses a provider pattern to abstract the specific details of communicating with different LLM APIs. This allows for flexibility in choosing which model(s) to use and makes it easier to add support for new providers in the future.

The core logic for these integrations can be found in the `src/providers/` directory.

## Key Components

*   **Provider Factory (`src/providers/providerFactory.ts`)**: Responsible for creating instances of the appropriate provider based on the bot's configuration (`config.yaml` or environment variables).
*   **Base Provider (`src/providers/baseProvider.ts`)**: Likely defines a common interface or abstract class that all specific providers must implement. This ensures a consistent way for the rest of the application to interact with any LLM.
*   **Specific Providers (`src/providers/openaiProvider.ts`, `src/providers/geminiProvider.ts`, `src/providers/ollamaProvider.ts`, etc.)**: Each file implements the logic for communicating with a specific LLM service, handling API requests, authentication, and response parsing according to that service's requirements.

## Configuration

LLM providers are configured in the `llm_providers` section of the `config.yaml` file or corresponding environment variables. Each provider requires specific configuration details, such as:

*   `enabled`: Whether the provider is active.
*   `api_key`: The API key for the service.
*   `model`: The specific model name to use (e.g., `gpt-4`, `gemini-pro`).
*   *(Other provider-specific options)*

Refer to `src/types/config.ts` for the exact configuration structure.

## Adding New Providers

To add support for a new LLM provider:

1.  Create a new provider class in `src/providers/` that implements the base provider interface (likely defined in `baseProvider.ts`).
2.  Implement the methods for making API calls to the new service.
3.  Update the `providerFactory.ts` to recognize and instantiate the new provider based on configuration.
4.  Update the configuration type definition in `src/types/config.ts` to include any necessary settings for the new provider.
5.  Add documentation for the new provider's configuration options.