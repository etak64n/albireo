// Errors that map to HTTP responses, and readers for JSON request bodies.
// The readers reject missing, mistyped, and unknown fields instead of
// guessing, so a client bug surfaces as a 400 response with a reason.

import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, "bad_request", message);
export const notFound = (message: string): HttpError => new HttpError(404, "not_found", message);
export const conflict = (message: string): HttpError => new HttpError(409, "conflict", message);
export const forbidden = (message: string): HttpError => new HttpError(403, "forbidden", message);

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(request: Request, fields: readonly string[]): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw badRequest("The request body must be JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("The request body must be a JSON object.");
  }
  const body = value as JsonObject;
  const unknown = Object.keys(body).filter((key) => !fields.includes(key));
  if (unknown.length > 0) throw badRequest(`The request body has unknown fields: ${unknown.join(", ")}.`);
  return body;
}

interface StringRule {
  min: number;
  max: number;
  trim: boolean;
}

export function readString(body: JsonObject, name: string, rule: StringRule): string {
  if (!(name in body)) throw badRequest(`${name} is required.`);
  return checkString(body[name], name, rule);
}

/** Returns undefined when the field is absent. */
export function readOptionalString(body: JsonObject, name: string, rule: StringRule): string | undefined {
  if (!(name in body)) return undefined;
  return checkString(body[name], name, rule);
}

function checkString(value: unknown, name: string, rule: StringRule): string {
  if (typeof value !== "string") throw badRequest(`${name} must be a string.`);
  const text = rule.trim ? value.trim() : value;
  if (text.length < rule.min || text.length > rule.max) {
    throw badRequest(`${name} must be ${rule.min} to ${rule.max} characters long.`);
  }
  return text;
}

export function readInteger(body: JsonObject, name: string, min: number, max: number): number {
  if (!(name in body)) throw badRequest(`${name} is required.`);
  const value = body[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw badRequest(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

/** Reads a field that must be present and may be null, for metadata the browser could not read. */
export function readNullableNumber(body: JsonObject, name: string, min: number, max: number, integer: boolean): number | null {
  if (!(name in body)) throw badRequest(`${name} is required. Send null when it is unknown.`);
  const value = body[name];
  if (value === null) return null;
  const valid = typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isInteger(value));
  if (!valid) throw badRequest(`${name} must be null or a ${integer ? "whole " : ""}number from ${min} to ${max}.`);
  return value;
}

export function readArray(body: JsonObject, name: string, minItems: number, maxItems: number): unknown[] {
  if (!(name in body)) throw badRequest(`${name} is required.`);
  const value = body[name];
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw badRequest(`${name} must be an array of ${minItems} to ${maxItems} items.`);
  }
  return value;
}

/** Reads an ID field that must be present and may be null. */
export function readNullableId(body: JsonObject, name: string, pattern: RegExp): string | null {
  if (!(name in body)) throw badRequest(`${name} is required. Send null for none.`);
  return checkNullableId(body[name], name, pattern);
}

/** Like readNullableId, but returns undefined when the field is absent. */
export function readOptionalNullableId(body: JsonObject, name: string, pattern: RegExp): string | null | undefined {
  if (!(name in body)) return undefined;
  return checkNullableId(body[name], name, pattern);
}

function checkNullableId(value: unknown, name: string, pattern: RegExp): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !pattern.test(value)) throw badRequest(`${name} must be null or an ID.`);
  return value;
}
