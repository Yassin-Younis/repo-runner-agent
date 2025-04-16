import OpenAI from 'openai';
import * as logger from '../utils/logger';

let openaiClient: OpenAI | null = null;

export function initializeOpenAI(apiKey: string): OpenAI {
    if (!apiKey) {
        const errorMsg = "OpenAI API key is required.";
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }
    if (!openaiClient) {
        logger.log("Initializing OpenAI client...");
        openaiClient = new OpenAI({ apiKey });
    }
    return openaiClient;
}

export function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        throw new Error("OpenAI client has not been initialized. Call initializeOpenAI first.");
    }
    return openaiClient;
}