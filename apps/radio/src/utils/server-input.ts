import { AppError } from "@avoid.quest/error";
import type { z } from "zod";

export function validateServerInput<T>(schema: z.ZodType<T>) {
  return (input: unknown): T => {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new AppError({
        category: "validation",
        code: "INVALID_SERVER_INPUT",
        safeMessage: result.error.message,
      });
    }
    return result.data;
  };
}
