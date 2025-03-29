import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

# Import the provider class and base class for type checking
from llmcord.providers.openai import OpenAIProvider
from llmcord.providers.base import LLMProvider

# Mark all tests in this module as asyncio
pytestmark = pytest.mark.asyncio

# --- Fixture for OpenAIProvider Instance ---

@pytest_asyncio.fixture
async def openai_provider(mock_config):
    """Provides an initialized OpenAIProvider instance with mocked client."""
    # Set necessary config values BEFORE setup is called
    # ProviderFactory expects model = "provider_name/model_name"
    mock_config.set_value("model", "openai/gpt-4-test")
    # Provider setup expects config["providers"][provider_name]
    mock_config.set_value("providers", {
        "openai": {
            "api_key": "fake_key",
            "base_url": "http://localhost:1234" # Example base_url needed by setup
        }
    })
    mock_config.set_value("extra_api_parameters", {}) # Needed by setup

    # Mock the actual OpenAI client library
    mock_openai_client = AsyncMock()
    mock_openai_client.chat.completions.create = AsyncMock() # Mock the method we'll call

    with patch('llmcord.providers.openai.AsyncOpenAI', return_value=mock_openai_client):
        # Instantiate provider without args
        provider = OpenAIProvider()
        # Call setup with the config dict
        await provider.setup(mock_config._test_values)
        # Store the mock client on the provider instance for easy access in tests
        provider._test_mock_client = mock_openai_client
        yield provider

# --- Tests for OpenAIProvider ---

async def test_openai_provider_instance(openai_provider):
    """Test that the fixture creates a valid OpenAIProvider instance."""
    assert isinstance(openai_provider, OpenAIProvider)
    assert isinstance(openai_provider, LLMProvider)
    assert openai_provider.model_name == "gpt-4-test"

async def test_openai_generate_stream_simple(openai_provider):
    """Test generate_stream with a simple mocked stream response."""
    # Prepare input messages
    messages = [{"role": "user", "content": "Hello OpenAI"}]
    system_prompt = "You are a helpful assistant."

    # --- Mock the response from openai.AsyncOpenAI().chat.completions.create ---
    # This method should return an async generator (stream)
    mock_stream_chunk_1 = MagicMock()
    mock_stream_chunk_1.choices = [MagicMock(delta=MagicMock(content="Hello "), finish_reason=None)] # Set finish_reason
    mock_stream_chunk_1.usage = None # Usage is usually None until the end

    mock_stream_chunk_2 = MagicMock()
    mock_stream_chunk_2.choices = [MagicMock(delta=MagicMock(content="World!"), finish_reason=None)] # Set finish_reason
    mock_stream_chunk_2.usage = None

    mock_stream_chunk_final = MagicMock()
    mock_stream_chunk_final.choices = [MagicMock(delta=MagicMock(content=None))] # End of stream often has None content
    # Simulate finish reason on the last chunk's choice or the chunk itself
    mock_stream_chunk_final.choices[0].finish_reason = "stop"
    mock_stream_chunk_final.usage = MagicMock(prompt_tokens=10, completion_tokens=5) # Example usage

    async def mock_stream_generator(*args, **kwargs):
        yield mock_stream_chunk_1
        yield mock_stream_chunk_2
        yield mock_stream_chunk_final

    openai_provider._test_mock_client.chat.completions.create.return_value = mock_stream_generator()
    # --- End Mocking ---

    # Collect results from the generator
    results = []
    async for chunk_text, finish_reason in openai_provider.generate_stream(messages, system_prompt):
        results.append((chunk_text, finish_reason))

    # Assertions
    # Check that the OpenAI client was called correctly
    openai_provider._test_mock_client.chat.completions.create.assert_called_once()
    call_args, call_kwargs = openai_provider._test_mock_client.chat.completions.create.call_args
    assert call_kwargs["model"] == "gpt-4-test"
    assert call_kwargs["stream"] is True
    # The provider appends the system prompt to the messages list
    # Check the actual list passed to the mock call
    assert call_kwargs["messages"] == [
        {"role": "user", "content": "Hello OpenAI"},
        {"role": "system", "content": system_prompt}
    ]

    # Check the generated output chunks and finish reason
    assert len(results) == 3 # One per yield from the mock generator
    assert results[0] == ("Hello ", None)
    assert results[1] == ("World!", None)
    assert results[2] == ("", "stop") # Last chunk yields empty text and finish reason

# Add more tests:
# - Test with different message roles
# - Test with max_tokens, temperature etc. if the provider passes them
# - Test handling of API errors (e.g., mocking create to raise an exception)
# - Test handling of empty or None chunks from the API stream
# - Test multimodal input if supported (needs more complex mocking)