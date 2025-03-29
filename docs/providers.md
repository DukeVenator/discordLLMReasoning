# LLM Provider Configuration

LLMCord supports connecting to various Large Language Model providers. This guide explains how to configure them in your `config.yaml` file under the `providers` section.

## General Structure

The `providers` section is a dictionary where each key is a unique name you assign to a provider configuration (e.g., `openai`, `google-gemini`, `my-local-model`).

```yaml
providers:
  # Provider configurations go here...
  openai:
    base_url: https://api.openai.com/v1
    api_key: YOUR_OPENAI_API_KEY
  google-gemini:
    api_key: YOUR_GOOGLE_API_KEY
  # ... other providers
```

After configuring providers, you select the default one using the top-level `model` setting:

```yaml
# Select the provider and model. Format: provider_name/model_name
model: google-gemini/gemini-1.5-pro-latest
```

## OpenAI &amp; Compatible APIs

This configuration type works for OpenAI itself and any provider offering an OpenAI-compatible API endpoint. This includes services like Groq, Mistral AI, OpenRouter, and local models served via tools like Ollama, LMStudio, vLLM, etc.

*   **Required Parameters:**
    *   `base_url`: The API endpoint URL provided by the service.
    *   `api_key`: Your API key for the service. (May not be required for some local models).

*   **Example Configurations:**

    ```yaml
    providers:
      # Official OpenAI
      openai:
        base_url: https://api.openai.com/v1
        api_key: YOUR_OPENAI_API_KEY # sk-...

      # Groq
      groq:
        base_url: https://api.groq.com/openai/v1
        api_key: YOUR_GROQ_API_KEY # gsk_...

      # Mistral AI
      mistral:
        base_url: https://api.mistral.ai/v1
        api_key: YOUR_MISTRAL_API_KEY

      # OpenRouter (can proxy many models)
      openrouter:
        base_url: https://openrouter.ai/api/v1
        api_key: YOUR_OPENROUTER_API_KEY # sk-or-...

      # Local Ollama instance
      ollama:
        base_url: http://localhost:11434/v1
        # api_key: Usually not required

      # Local LMStudio instance
      lmstudio:
        base_url: http://localhost:1234/v1
        # api_key: Usually not required
    ```

*   **Model Selection:** When using the `model` setting, combine the provider name (the key you defined, e.g., `groq`) with the actual model name supported by that provider's endpoint.
    *   *Example:* `model: groq/llama3-70b-8192`
    *   *Example:* `model: ollama/llama3`

## Google Gemini (Native API)

LLMCord also supports Google Gemini models via their native API, using the `google-generativeai` library.

*   **Required Parameters:**
    *   `api_key`: Your Google API Key (obtained from Google AI Studio or Google Cloud Platform).

*   **Note:** The `base_url` parameter is *not* used for this provider type, as the library handles the endpoint internally.

*   **Example Configuration:**

    ```yaml
    providers:
      google-gemini:
        api_key: YOUR_GOOGLE_API_KEY # AIza...
    ```

*   **Model Selection:** Combine the provider name (`google-gemini`) with the desired Gemini model name.
    *   *Example:* `model: google-gemini/gemini-1.5-pro-latest`
    *   *Example:* `model: google-gemini/gemini-1.5-flash-latest`

## Extra API Parameters

You can pass additional, provider-specific parameters using the top-level `extra_api_parameters` section in `config.yaml`. See the [Configuration Guide](./configuration.md#extra-api-parameters) for details. Consult your chosen provider's documentation for supported parameters.