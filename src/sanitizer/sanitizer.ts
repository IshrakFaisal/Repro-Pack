import type { AppConfig } from "../config/env";
import type { SanitizationReportItem, SanitizedPayload } from "../types/schemas";

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?<!\d)(?:\+?\d[\d().\s-]{7,}\d)(?!\d)/g;
const bearerPattern = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const genericSecretPattern = /\b[A-Za-z0-9_\/+=-]{24,}\b/g;
const maskedEmailPattern = /\b[A-Z0-9._%+-]+\s+(?:at|\[at\]|\(at\))\s+[A-Z0-9.-]+\s+(?:dot|\[dot\]|\(dot\))\s+[A-Z]{2,}\b/gi;
const phoneWordsPattern =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}\b/gi;

function hasMatch(pattern: RegExp, input: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(input);
}

function isPaymentLike(input: string): boolean {
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function replacement(label: string): string {
  return `[REDACTED:${label}]`;
}

function keyIndicatesSensitiveField(key: string): "api-key" | "cookie" | "auth-header" | "direct-id" | "semantic-pii" | "locale-id" | undefined {
  const normalized = key.toLowerCase();

  if (["authorization", "proxy-authorization", "auth", "authheader"].includes(normalized)) {
    return "auth-header";
  }
  if (["cookie", "set-cookie"].includes(normalized)) {
    return "cookie";
  }
  if (["x-api-key", "apikey", "api_key", "api-key", "token", "access_token", "refresh_token"].includes(normalized)) {
    return "api-key";
  }
  if (
    ["userid", "user_id", "accountid", "account_id", "workspaceid", "workspace_id", "customerid", "customer_id"].includes(
      normalized
    )
  ) {
    return "direct-id";
  }
  if (
    [
      "ssn",
      "socialsecuritynumber",
      "nationalid",
      "national_id",
      "passport",
      "passportnumber",
      "driverlicense",
      "driverslicense",
      "taxid",
      "tax_id",
      "cpf",
      "cnpj",
      "aadhaar",
      "nid"
    ].includes(normalized)
  ) {
    return "locale-id";
  }
  if (
    [
      "name",
      "fullname",
      "full_name",
      "firstname",
      "first_name",
      "lastname",
      "last_name",
      "address",
      "postaladdress",
      "postal_address",
      "dateofbirth",
      "date_of_birth",
      "dob"
    ].includes(normalized)
  ) {
    return "semantic-pii";
  }

  return undefined;
}

function pushReport(
  report: SanitizationReportItem[],
  location: string,
  redactionType: string,
  classification: string,
  replacementStrategy: string
) {
  report.push({
    location,
    redactionType,
    classification,
    replacementStrategy
  });
}

function sanitizeStringValue(
  value: string,
  path: string,
  keyName: string | undefined,
  config: AppConfig,
  report: SanitizationReportItem[]
): string {
  let current = value;
  const keyType = keyName ? keyIndicatesSensitiveField(keyName) : undefined;

  if (keyType === "auth-header") {
    pushReport(report, path, "mask", "auth-header", "replace_entire_value");
    return replacement("AUTH_HEADER");
  }
  if (keyType === "cookie") {
    pushReport(report, path, "mask", "cookie", "replace_entire_value");
    return replacement("COOKIE");
  }
  if (keyType === "api-key") {
    pushReport(report, path, "mask", "api-key", "replace_entire_value");
    return replacement("API_KEY");
  }
  if (keyType === "direct-id" && config.redactDirectIdentifiers) {
    pushReport(report, path, "mask", "direct-identifier", "replace_entire_value");
    return replacement("IDENTIFIER");
  }
  if (keyType === "locale-id") {
    pushReport(report, path, "mask", "locale-specific-identifier", "replace_entire_value");
    return replacement("IDENTIFIER");
  }
  if (keyType === "semantic-pii" && config.redactDirectIdentifiers) {
    pushReport(report, path, "mask", "semantic-pii", "replace_entire_value");
    return replacement("PII");
  }

  if (hasMatch(emailPattern, current)) {
    current = current.replace(emailPattern, replacement("EMAIL"));
    pushReport(report, path, "mask", "email", "pattern_replace");
  }

  if (hasMatch(maskedEmailPattern, current)) {
    current = current.replace(maskedEmailPattern, replacement("EMAIL"));
    pushReport(report, path, "mask", "masked-email", "pattern_replace");
  }

  if (hasMatch(bearerPattern, current)) {
    current = current.replace(bearerPattern, replacement("BEARER_TOKEN"));
    pushReport(report, path, "mask", "bearer-token", "pattern_replace");
  }

  if (config.redactIps && hasMatch(ipv4Pattern, current)) {
    current = current.replace(ipv4Pattern, replacement("IP"));
    pushReport(report, path, "mask", "ip-address", "pattern_replace");
  }

  const paymentPattern = /(?:\d[ -]*){13,19}/g;
  if (hasMatch(paymentPattern, current)) {
    current = current.replace(paymentPattern, (match) => {
      if (isPaymentLike(match)) {
        pushReport(report, path, "mask", "payment-card", "pattern_replace");
        return replacement("PAYMENT");
      }

      return match;
    });
  }

  if (hasMatch(genericSecretPattern, current)) {
    current = current.replace(genericSecretPattern, (match) => {
      if (/^[A-Za-z0-9_\/+=-]{24,}$/.test(match) && !match.startsWith("[REDACTED:")) {
        pushReport(report, path, "mask", "secret-like-string", "pattern_replace");
        return replacement("SECRET");
      }

      return match;
    });
  }

  if (hasMatch(phonePattern, current)) {
    current = current.replace(phonePattern, replacement("PHONE"));
    pushReport(report, path, "mask", "phone", "pattern_replace");
  }

  if (hasMatch(phoneWordsPattern, current)) {
    current = current.replace(phoneWordsPattern, replacement("PHONE"));
    pushReport(report, path, "mask", "phone-words", "pattern_replace");
  }

  return current;
}

function sanitizeNode(
  value: unknown,
  path: string,
  keyName: string | undefined,
  config: AppConfig,
  report: SanitizationReportItem[]
): unknown {
  if (typeof value === "string") {
    return sanitizeStringValue(value, path, keyName, config, report);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeNode(entry, `${path}[${index}]`, undefined, config, report));
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(objectValue).map(([key, entry]) => [
        key,
        sanitizeNode(entry, `${path}.${key}`, key, config, report)
      ])
    );
  }

  return value;
}

export function sanitizePayload(payload: unknown, config: AppConfig): SanitizedPayload {
  const report: SanitizationReportItem[] = [];
  const sanitized = sanitizeNode(payload, "root", undefined, config, report);
  return {
    payload: sanitized,
    report
  };
}
