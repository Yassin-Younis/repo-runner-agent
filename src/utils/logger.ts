import { AGENT_NAME, MAX_LOG_OUTPUT_LENGTH } from '../config';

const logPrefix = `[${AGENT_NAME}]`;

export function log(message: string, ...args: any[]) {
    console.log(`${logPrefix} ${message}`, ...args);
}

export function warn(message: string, ...args: any[]) {
    console.warn(`${logPrefix} ${message}`, ...args);
}

export function error(message: string, ...args: any[]) {
    console.error(`${logPrefix} ${message}`, ...args);
}

export function logPreview(label: string, data: string | object | null | undefined) {
    let preview: string;
    if (typeof data === 'string') {
        preview = data.substring(0, MAX_LOG_OUTPUT_LENGTH) + (data.length > MAX_LOG_OUTPUT_LENGTH ? "..." : "");
    } else if (data) {
        const jsonString = JSON.stringify(data);
        preview = jsonString.substring(0, MAX_LOG_OUTPUT_LENGTH) + (jsonString.length > MAX_LOG_OUTPUT_LENGTH ? "..." : "");
    } else {
        preview = '[No Data]';
    }
    log(`${label} (preview): ${preview}`);
}