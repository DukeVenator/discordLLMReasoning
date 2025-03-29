import yaml
import logging
from typing import Dict, Any, Optional

log = logging.getLogger(__name__)

class Config:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Config, cls).__new__(cls)
            cls._instance._data = {}
            cls._instance._loaded = False
        return cls._instance
    
    def load(self, filename="config.yaml"):
        """Load configuration from file with defaults and validation."""
        try:
            with open(filename, "r") as file:
                # Default Config Structure
                default_config = {
                    "bot_token": None, 
                    "client_id": None, 
                    "status_message": None,
                    "max_text": 100000, 
                    "max_images": 5, 
                    "max_messages": 25,
                    "use_plain_responses": False, 
                    "allow_dms": True,
                    "permissions": {
                        "users": {"allowed_ids": [], "blocked_ids": []},
                        "roles": {"allowed_ids": [], "blocked_ids": []},
                        "channels": {"allowed_ids": [], "blocked_ids": []}
                    },
                    "providers": {}, 
                    "model": "openai/gpt-4o",
                    "extra_api_parameters": {"max_tokens": 4096, "temperature": 1.0},
                    "system_prompt": "You are a helpful Discord chatbot.",
                    "memory": {
                        "enabled": False,
                        "database_path": "llmcord_memory.db",
                        "prompt_injection_method": "system_prompt_prefix",
                        "memory_prefix": "[User Memory/Notes]:\n",
                        "max_memory_length": 1500,
                        "llm_suggests_memory": False,
                        "memory_suggestion_prompt": "",
                        "memory_suggestion_start_marker": "[MEM_UPDATE]",
                        "memory_suggestion_end_marker": "[/MEM_UPDATE]",
                        "memory_suggestion_mode": "append",
                        "memory_suggestion_append_prefix": "\n- ",
                        "show_addition_confirmation": True # Show a confirmation message when memory is added/updated
                    },
                    "multimodel": {
                        "enabled": False,
                        "reasoning_model": None, # Example: "openai/gpt-4o"
                        "reasoning_signal": "[USE_REASONING_MODEL]",
                        "notify_user": True,
                        "reasoning_extra_api_parameters": {}, # e.g., {"max_tokens": 8192, "temperature": 0.5}
                    },
                    "rate_limits": {
                        "enabled": True,
                        "user_limit": 5,
                        "user_period": 60,
                        "global_limit": 100, # Default global limit
                        "global_period": 60, # Default global period
                        # "admin_bypass": True # Optional, keep default as undefined/False
                        "reasoning_user_limit": 2,
                        "reasoning_user_period": 300,
                        "reasoning_global_limit": None,
                        "reasoning_global_period": None,
                    }
                }

                loaded_config = yaml.safe_load(file)
                if not loaded_config:
                    raise ValueError("Config file is empty or invalid.")

                # Merge configurations
                self._data = self._merge_dicts(default_config, loaded_config)
                
                # Validate required fields
                self._validate_config()
                self._loaded = True
                
                return self._data
                
        except FileNotFoundError:
            log.critical(f"CRITICAL: Configuration file '{filename}' not found. Exiting.")
            exit()
        except Exception as e:
            log.critical(f"CRITICAL: Error loading configuration from '{filename}': {e}")
            exit()
    
    def _merge_dicts(self, default, loaded):
        """Deep merge two dictionaries."""
        merged = default.copy()
        for key, value in loaded.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self._merge_dicts(merged[key], value)
            else:
                merged[key] = value
        return merged
    
    def _validate_config(self):
        """Validate required configuration fields."""
        if not self._data.get("bot_token"):
            raise ValueError("`bot_token` is missing in config.yaml")
        if "/" not in self._data.get("model", ""):
            raise ValueError("`model` format must be 'provider_name/model_name'")
    
    def get(self, key=None, default=None):
        """Get a configuration value."""
        if not self._loaded:
            raise RuntimeError("Configuration not loaded. Call load() first.")
        
        if key is None:
            return self._data
            
        keys = key.split('.') if '.' in key else [key]
        value = self._data
        
        try:
            for k in keys:
                value = value[k]
            return value
        except (KeyError, TypeError):
            return default
    
    def __getitem__(self, key):
        return self.get(key)