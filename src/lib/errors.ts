// Safely extracts a human-readable message from an unknown thrown value.
// Catch blocks receive `unknown` under strict TypeScript, so this avoids
// scattering `catch (error: any)` casts across the codebase.
export const getErrorMessage = (error: unknown, fallback = 'An unexpected error occurred.'): string => {
    return error instanceof Error ? error.message : fallback;
};
