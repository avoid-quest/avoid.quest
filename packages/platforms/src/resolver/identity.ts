const UNSAFE_ID_CHARACTER_PATTERN = /[^a-zA-Z0-9._:-]/g;

export function sanitizeResolverId(id: string): string {
  return (
    id.slice(0, 80).replace(UNSAFE_ID_CHARACTER_PATTERN, "_") || "resolver"
  );
}
