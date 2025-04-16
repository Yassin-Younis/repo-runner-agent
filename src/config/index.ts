import path from 'path';
import os from 'os';

export const AGENT_NAME = "RepoRunnerAgent";

// --- Behavior Configuration ---
export const MAX_FILE_CONTENT_LENGTH = 5000;
export const MAX_DIR_LISTING_DEPTH = 3;
export const MAX_DIR_ITEMS = 100;
export const DEFAULT_COMMAND_TIMEOUT = 120000; // 2 minutes
export const SERVER_START_TIMEOUT = 30000; // 30 seconds
export const MAX_LLM_TURNS = 15;
export const MAX_TOOL_RESULT_LENGTH = 4000;
export const MAX_LOG_OUTPUT_LENGTH = 500;

// --- OpenAI Configuration ---
// Note: API Key should ideally be passed in, not hardcoded/read from env here directly
export const LLM_MODEL = "gpt-4o";

// --- Temporary Directory Prefix ---
export const TEMP_DIR_PREFIX = path.join(os.tmpdir(), 'repoRunner-');

// --- Type Definitions (Optional but helpful) ---
export interface ProcessInfo {
    pid: number;
    command: string;
}

export interface FinalOutcome {
    status: 'success' | 'failure';
    url: string | null;
    notes: string;
    repoPath: string; // Include the path for potential external cleanup if needed
}

export interface ToolResult {
    success: boolean;
    content?: string; // For inspectFile
    message?: string; // For createFile/editFile
    stdout?: string; // For runCommand
    stderr?: string; // For runCommand
    exitCode?: number | null; // For runCommand
    timedOut?: boolean; // For runCommand
    signal?: string | null; // For runCommand
    pid?: number; // For runCommand (especially long-running)
    isRunningDetached?: boolean; // For runCommand
    detectedPort?: string | null; // For runCommand (long-running)
    notes?: string; // For runCommand feedback
    error?: string; // General error message
    finalOutcome?: Omit<FinalOutcome, 'repoPath'>; // For markRunning/markUnrunnable
}

export interface RunOptions {
    repoUrl: string;
    commitHash: string;
    openaiApiKey: string;
    githubToken?: string | null;
}