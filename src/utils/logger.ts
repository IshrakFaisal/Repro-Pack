import pino from "pino";

export function createLogger(level: string) {
  return pino(
    {
      level,
      base: undefined,
      messageKey: "message",
      formatters: {
        level: (label) => ({ level: label })
      }
    },
    pino.destination(2)
  );
}
