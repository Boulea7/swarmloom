// @ts-check
/** Small JSON helpers with error messages that name the offending file. */
import { readFileSync } from "node:fs";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads and parses a JSON file.
 * @param {string} path
 * @returns {unknown}
 */
export function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${/** @type {Error} */ (error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${/** @type {Error} */ (error).message}`);
  }
}
