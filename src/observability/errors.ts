export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

export function classifyError(error: unknown): { code: string; message: string; statusCode: number } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, statusCode: error.statusCode };
  }

  if (error instanceof Error && typeof (error as Error & { statusCode?: number }).statusCode === "number") {
    return {
      code: "request_error",
      message: error.message,
      statusCode: (error as Error & { statusCode: number }).statusCode
    };
  }

  if (error instanceof Error) {
    return { code: "internal_error", message: error.message, statusCode: 500 };
  }

  return { code: "internal_error", message: "Unknown error", statusCode: 500 };
}
