import path from 'path';

/**
 * Resolves a relative path against a base repository path, ensuring it doesn't traverse upwards
 * or access forbidden directories like .git.
 * @param repoPath The absolute path to the repository root.
 * @param relativePath The user-provided relative path.
 * @returns The absolute, validated path.
 * @throws Error if path traversal is detected or forbidden directory access is attempted.
 */
export function resolveSecurePath(repoPath: string, relativePath: string): string {
    const normalizedRelativePath = path.normalize(relativePath);

    // Basic check for attempts to go above repoPath
    if (normalizedRelativePath.startsWith('..') || path.isAbsolute(normalizedRelativePath)) {
        throw new Error(`Invalid path: ${relativePath}. Must be relative within the repository.`);
    }

    const absolutePath = path.resolve(repoPath, normalizedRelativePath);

    // Verify the resolved path is still inside the repoPath
    if (!absolutePath.startsWith(path.resolve(repoPath) + path.sep) && absolutePath !== path.resolve(repoPath)) {
        throw new Error(`Path traversal detected: ${relativePath}`);
    }

    // Prevent access to .git directory
    if (normalizedRelativePath === '.git' || normalizedRelativePath.startsWith(path.join('.git', path.sep)) || normalizedRelativePath.includes(path.sep + '.git' + path.sep) || normalizedRelativePath.endsWith(path.sep + '.git')) {
        throw new Error(`Access to .git directory is forbidden: ${relativePath}`);
    }

    // Add other forbidden paths if needed (e.g., .env files if sensitive)
    // if (normalizedRelativePath.endsWith('.env')) {
    //     throw new Error(`Direct access to .env files might be restricted.`);
    // }

    return absolutePath;
}