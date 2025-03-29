from setuptools import setup, find_packages

setup(
    name="llmcord",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "discord.py>=2.0.0",
        "httpx>=0.25.0",
        "openai>=1.0.0",
        "PyYAML>=6.0",
        "aiosqlite>=0.17.0",
        "google-generativeai>=0.4.0",
    ],
    entry_points={
        "console_scripts": [
            "llmcord=llmcord.main:main",
        ],
    },
    author="jakobdylanc",
    author_email="example@example.com",
    description="Discord bot for interacting with large language models",
    keywords="discord, llm, bot, chatbot",
    python_requires=">=3.9",
)