import { ChatCompletionTool } from 'openai/resources/chat/completions';
import {
    MAX_FILE_CONTENT_LENGTH,
    SERVER_START_TIMEOUT,
    DEFAULT_COMMAND_TIMEOUT
} from '../config';

// Define the tools for the LLM
export const tools: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "inspectFile",
            description: `Reads the content of a specific file within the cloned repository. Returns up to ${MAX_FILE_CONTENT_LENGTH} characters.`,
            parameters: {
                type: "object",
                properties: {
                    filePath: {
                        type: "string",
                        description: "The relative path to the file from the repository root (e.g., 'package.json', 'README.md', 'src/index.js').",
                    },
                },
                required: ["filePath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "createFile",
            description: "Creates a new file with the specified content. Useful for creating .env files from examples or instructions. Overwrites if the file exists.",
            parameters: {
                type: "object",
                properties: {
                    filePath: {
                        type: "string",
                        description: "The relative path where the file should be created (e.g., '.env', 'config/config.json').",
                    },
                    content: {
                        type: "string",
                        description: "The content to write into the file.",
                    },
                },
                required: ["filePath", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "editFile",
            description: "WARNING: Overwrites the entire content of an existing file. Use cautiously, perhaps for minor config adjustments. Prefer createFile for .env.",
            parameters: {
                type: "object",
                properties: {
                    filePath: {
                        type: "string",
                        description: "The relative path of the file to overwrite.",
                    },
                    content: {
                        type: "string",
                        description: "The new content for the file.",
                    },
                },
                required: ["filePath", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "runCommand",
            description: `Executes a shell command. Use 'isLongRunning: true' for commands that start servers or background processes (e.g., 'npm start', 'npm run dev', 'docker compose up'). For these, the command runs detached, and the tool reports initial output success/failure within ${SERVER_START_TIMEOUT / 1000}s. For others ('isLongRunning: false' or omitted), it waits for completion or timeout (${DEFAULT_COMMAND_TIMEOUT / 1000}s default).`,
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "The command to execute (e.g., 'npm', 'yarn', 'node', 'docker').",
                    },
                    args: {
                        type: "array",
                        items: { type: "string" },
                        description: "Arguments for the command (e.g., ['install'], ['run', 'dev'], ['server.js']).",
                    },
                    isLongRunning: {
                        type: "boolean",
                        description: "Set to 'true' if this command is expected to run continuously in the background (e.g., starting a web server). Defaults to 'false'.",
                        default: false,
                    },
                    timeout: {
                        type: "integer",
                        description: `Optional override timeout in milliseconds for non-long-running commands. Default: ${DEFAULT_COMMAND_TIMEOUT}ms. Ignored if isLongRunning=true.`,
                    }
                },
                required: ["command", "args"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "markRunning",
            description: "Call this function ONLY when you are confident the project is successfully running and likely accessible, providing the presumed local URL. This should typically follow a successful 'runCommand' with 'isLongRunning: true'.",
            parameters: {
                type: "object",
                properties: {
                    deploymentUrl: {
                        type: "string",
                        description: "The local URL where the application is likely running (e.g., 'http://localhost:3000', 'http://127.0.0.1:8080').",
                    },
                    notes: {
                        type: "string",
                        description: "Any relevant notes about how the project was run (e.g., required .env setup, specific command used, PID of the running process if available)."
                    }
                },
                required: ["deploymentUrl"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "markUnrunnable",
            description: "Call this function ONLY when you have determined that the project cannot be run successfully after reasonable attempts, or setup instructions are missing/unclear.",
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "A clear explanation of why the project cannot be run (e.g., 'Build failed due to missing dependency X', 'npm start failed to produce success output within timeout', 'Docker compose failed').",
                    },
                },
                required: ["reason"],
            },
        },
    },
];