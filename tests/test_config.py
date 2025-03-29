import pytest
from llmcord.config import Config # Import the actual class for type checking if needed

# Tests for the Config class (using the mock_config fixture)

def test_config_get_default_values(mock_config):
    """Test that the mock_config fixture provides expected default values."""
    assert mock_config.get("allow_dms") is True
    assert mock_config.get("model") == "mock-model"
    assert mock_config.get("memory.enabled") is False
    assert mock_config.get("non_existent_key") is None
    assert mock_config.get("non_existent_key", "custom_default") == "custom_default"

def test_config_set_and_get_value(mock_config):
    """Test setting a value and retrieving it using the mock_config fixture."""
    mock_config.set_value("new_setting", "new_value")
    assert mock_config.get("new_setting") == "new_value"

def test_config_set_and_get_nested_value(mock_config):
    """Test setting and retrieving a nested value."""
    mock_config.set_value("database.host", "localhost")
    mock_config.set_value("database.port", 5432)

    assert mock_config.get("database.host") == "localhost"
    assert mock_config.get("database.port") == 5432
    assert mock_config.get("database.user") is None # Not set

def test_config_get_nested_default(mock_config):
    """Test retrieving a nested value with a default."""
    assert mock_config.get("database.user", "default_user") == "default_user"

def test_config_overwrite_value(mock_config):
    """Test overwriting an existing value."""
    mock_config.set_value("model", "new-mock-model")
    assert mock_config.get("model") == "new-mock-model"

def test_config_isolation(mock_config):
    """
    Test that values set in one test do not affect others.
    Relies on the fixture's setup/teardown (clearing mock_values).
    """
    # This test gets a fresh mock_config instance.
    # Check a value that might have been set in another test.
    assert mock_config.get("new_setting") is None
    assert mock_config.get("database.host") is None
    # Verify default is still there
    assert mock_config.get("model") == "mock-model"

# Add more tests here as needed, e.g., testing the actual load method
# if you decide to mock file reading instead of just the Config object itself.