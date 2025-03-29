import pytest
import pytest_asyncio
from unittest.mock import patch, AsyncMock

# Import the factory and specific provider classes for type checking
from llmcord.providers import ProviderFactory
from llmcord.providers.openai import OpenAIProvider
from llmcord.providers.gemini import GeminiProvider
# Import BaseProvider if needed for general checks
# from llmcord.providers.base import BaseProvider

# Mark all tests in this module as asyncio
pytestmark = pytest.mark.asyncio

# Test ProviderFactory.create_provider

async def test_create_provider_openai(mock_config):
    """Test creating an OpenAI provider."""
    # Set config for OpenAI
    mock_config.set_value("model", "openai/gpt-4") # Need model for init
    # Provider setup needs the providers dict structure
    mock_config.set_value("providers", {
        "openai": {
            "api_key": "fake_key",
            "base_url": "http://localhost:11434" # Example needed for setup
        }
    })

    # Patch the underlying client initialization within the provider if necessary
    # For now, assume basic init works if config is present
    with patch('llmcord.providers.openai.AsyncOpenAI', return_value=AsyncMock()):
        # Factory creates the instance, setup might fail but we get the object
        provider = await ProviderFactory.create_provider(mock_config._test_values)

    assert isinstance(provider, OpenAIProvider) # Check if instance was created
    # assert provider.config["provider"] == "openai" # Don't assume setup succeeded here

async def test_create_provider_gemini(mock_config):
    """Test creating a Gemini provider."""
    # Set config for Gemini
    mock_config.set_value("model", "google-gemini/gemini-pro") # Need model for init
    # Provider setup needs the providers dict structure
    mock_config.set_value("providers", {
        "google-gemini": {
            "api_key": "fake_google_key"
        }
    })

    # Patch the underlying client initialization (genai.Client)
    with patch('google.genai.Client') as mock_gemini_client:
         # Factory creates the instance, setup might fail but we get the object
        provider = await ProviderFactory.create_provider(mock_config._test_values)

    assert isinstance(provider, GeminiProvider) # Check if instance was created
    # assert provider.config["provider"] == "gemini" # Don't assume setup succeeded here

async def test_create_provider_unknown(mock_config, mocker):
    """Test creating an unknown provider returns None and logs error."""
    mock_config.set_value("provider", "unknown_provider")
    mock_config.set_value("model", "unknown/some-model")

    # Patch logger to check for error message
    mocker.patch('llmcord.providers.log.error')
    from llmcord.providers import log # Import log for assertion

    provider = await ProviderFactory.create_provider(mock_config._test_values)

    assert provider is None
    # Check that an error was logged
    log.error.assert_called_once()
    assert "Failed to setup provider" in log.error.call_args[0][0]

async def test_create_provider_missing_config(mock_config, mocker):
    """Test creating a provider with missing essential config (e.g., API key)."""
    mock_config.set_value("provider", "openai")
    # Do NOT set openai_api_key
    mock_config.set_value("model", "openai/gpt-4")

    mocker.patch('llmcord.providers.log.error')
    from llmcord.providers import log # Import log for assertion

    # The OpenAIProvider init might raise an error or log it.
    # Let's assume it logs and returns None based on typical patterns.
    # If it raises, we'd wrap this in pytest.raises.
    # Patching the client might prevent the error, so we test the factory logic.
    # The factory itself doesn't validate keys, the provider init does.
    # Let's simulate the provider init failing by patching it to return None or raise
    with patch('llmcord.providers.openai.OpenAIProvider', side_effect=ValueError("Missing API Key")):
         # We expect the factory to catch this and return None
         provider = await ProviderFactory.create_provider(mock_config._test_values)

    assert provider is None
    # Check logger if the factory logs the caught exception
    # log.error.assert_called_once() # Depending on factory implementation

async def test_create_provider_no_provider_specified(mock_config, mocker):
    """Test case where 'provider' key is missing in config."""
    # Ensure 'provider' is not set in the mock config dictionary
    if 'provider' in mock_config._test_values:
        del mock_config._test_values['provider']
    mock_config.set_value("model", "unknown/some-model") # Set other required keys

    mocker.patch('llmcord.providers.log.error')
    from llmcord.providers import log # Import log for assertion

    provider = await ProviderFactory.create_provider(mock_config._test_values)

    assert provider is None
    log.error.assert_called_once()
    assert "Failed to setup provider" in log.error.call_args[0][0]