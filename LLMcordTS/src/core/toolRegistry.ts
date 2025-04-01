import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url'; // Import pathToFileURL
import { ToolDefinition, ToolImplementation } from '../types/tools'; // Import correct types

export class ToolRegistry {
    private tools: Map<string, ToolImplementation> = new Map(); // Use imported type
    private toolsDir: string;

    constructor(toolsDirectory: string = path.join(__dirname, '../tools')) {
        this.toolsDir = toolsDirectory;
    }

    async loadTools(): Promise<void> {
        console.log(`Loading tools from: ${this.toolsDir}`);
        try {
            const files = await fs.readdir(this.toolsDir);
            // Always look for compiled .js files, assuming a build has been run.
            const fileExtension = 'Tool.js';
            const toolFiles = files.filter(file => file.endsWith(fileExtension) && !file.includes('.test.')); // Check includes for test files

            console.log(`Found potential tool files: ${toolFiles.join(', ')}`);

            for (const file of toolFiles) {
                const filePath = path.join(this.toolsDir, file);
                const absoluteFilePath = path.resolve(filePath); // Ensure absolute path for dynamic import
                console.log(`Attempting to import tool: ${absoluteFilePath}`);
                try {
                    // Use file URL for dynamic import
                    const moduleUrl = pathToFileURL(absoluteFilePath).href; // Use the imported function
                    const module = await import(moduleUrl);

                    // Tool files use named exports matching the filename (e.g., calculatorTool.ts exports calculatorTool)
                    const exportName = path.basename(file, path.extname(file)); // e.g., "calculatorTool"
                    const toolInstance: ToolImplementation | undefined = module[exportName]; // Access named export

                    // Basic validation (can be expanded)
                    // Check for parameters property as well, based on imported ToolDefinition
                    if (toolInstance && typeof toolInstance.name === 'string' && typeof toolInstance.description === 'string' && typeof toolInstance.execute === 'function' && typeof toolInstance.parameters === 'object') {
                        if (this.tools.has(toolInstance.name)) {
                            console.warn(`Warning: Duplicate tool name "${toolInstance.name}" found in ${file}. Overwriting.`);
                        }
                        this.tools.set(toolInstance.name, toolInstance);
                        console.log(`Successfully loaded tool: ${toolInstance.name}`);
                    } else {
                        console.warn(`Warning: Invalid tool structure in ${file}. Skipping.`);
                    }
                } catch (error: any) {
                    console.error(`Error loading tool from ${file}:`, error.message || error);
                    if (error.stack) {
                        console.error(error.stack);
                    }
                }
            }
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.warn(`Tools directory not found: ${this.toolsDir}. No tools loaded.`);
            } else {
                console.error(`Error reading tools directory ${this.toolsDir}:`, error);
            }
        }
        console.log(`Tool loading complete. ${this.tools.size} tools loaded.`);
    }

    getToolDefinitions(): ToolDefinition[] { // Return imported type
        // Directly return the relevant parts from the stored ToolImplementation objects
        return Array.from(this.tools.values()).map(({ name, description, parameters }) => ({
            name,
            description,
            parameters, // This should now match the imported ToolDefinition structure
        }));
    }

    getTool(name: string): ToolImplementation | undefined { // Use imported type
        return this.tools.get(name);
    }

    async executeTool(name: string, args: any): Promise<any> {
        const tool = this.getTool(name);
        if (!tool) {
            throw new Error(`Tool "${name}" not found.`);
        }
        try {
            return await tool.execute(args);
        } catch (error: any) {
            console.error(`Error executing tool "${name}":`, error);
            // Re-throw or handle as appropriate for the application
            throw new Error(`Execution failed for tool "${name}": ${error.message}`);
        }
    }

    // Helper to get the number of loaded tools, useful for testing
    getToolCount(): number {
        return this.tools.size;
    }
}