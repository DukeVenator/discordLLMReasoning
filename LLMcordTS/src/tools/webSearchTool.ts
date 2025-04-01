import axios from 'axios';
import { ToolImplementation } from '../types/tools';
import { getConfigValue } from '../core/config';
import { logger } from '@/core/logger'; // Correct path alias

/**
 * Defines the structure of a single search result from the Brave Search API.
 * Based on https://api.search.brave.com/app/documentation/web-search/responses
 */
interface BraveSearchResult {
    title: string;
    url: string;
    description: string;
    // Add other potentially useful fields if needed, e.g., page_age, profile.name
}

/**
 * Tool implementation for performing a web search using the Brave Search API.
 */
export const webSearchTool: ToolImplementation = {
    name: 'web_search',
    description: 'Performs a web search for a given query using the configured provider (e.g., Brave Search).',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The search query.',
            },
        },
        required: ['query'],
    },
    async execute(args: { query: string }): Promise<string> {
        const { query } = args;

        const searchProvider = getConfigValue<string>('search.provider', 'none');
        const braveApiKey = getConfigValue<string>('search.brave.apiKey');
        const maxResults = getConfigValue<number>('search.maxResults', 3); // Default to 3 results

        if (searchProvider !== 'brave') {
            return `Web search is not enabled or the configured provider '${searchProvider}' is not supported by this tool.`;
        }

        if (!braveApiKey || braveApiKey.startsWith('YOUR_')) {
            return 'Brave Search API key is missing or invalid in the configuration. Cannot perform web search.';
        }

        const apiUrl = 'https://api.search.brave.com/res/v1/web/search';
        const headers = {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': braveApiKey,
        };

        try {
            logger.info(`Performing Brave web search for query: "${query}"`);
            const response = await axios.get(apiUrl, {
                params: { q: query },
                headers: headers,
            });

            if (response.status === 200 && response.data?.web?.results) {
                const results: BraveSearchResult[] = response.data.web.results;
                const topResults = results.slice(0, maxResults);

                if (topResults.length === 0) {
                    return `No web search results found for "${query}".`;
                }

                // Format results
                const formattedResults = topResults
                    .map((result, index) => {
                        // Basic sanitization/shortening
                        const title = result.title?.replace(/[\r\n]+/g, ' ').trim() || 'No Title';
                        const snippet = result.description?.replace(/[\r\n]+/g, ' ').trim() || 'No Snippet';
                        const url = result.url || '#';
                        return `Result ${index + 1}: [${title}](${url}) - ${snippet}`;
                    })
                    .join('\n\n'); // Separate results with double newline

                return `Web search results for "${query}":\n\n${formattedResults}`;
            } else {
                logger.warn(`Brave Search API returned unexpected status or data format: ${response.status}`, response.data);
                return `Error: Received unexpected response from Brave Search API (Status: ${response.status}).`;
            }
        } catch (error: any) {
            logger.error('Error during Brave Search API call:', error);
            let errorMessage = 'An unknown error occurred while performing the web search.';
            if (axios.isAxiosError(error)) {
                errorMessage = `Error fetching search results from Brave: ${error.message}`;
                if (error.response) {
                    errorMessage += ` (Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)})`;
                }
            } else if (error instanceof Error) {
                errorMessage = `Error performing web search: ${error.message}`;
            }
            return errorMessage;
        }
    },
};