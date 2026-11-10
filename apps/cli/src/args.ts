import { type ParseArgsConfig, parseArgs } from "node:util";
import { UsageError } from "./errors";

/** Option table accepted by {@link parseCommand} (the `options` of node:util parseArgs). */
export type OptionSpecs = NonNullable<ParseArgsConfig["options"]>;

type StrictConfig<O extends OptionSpecs> = { args: string[]; options: O; allowPositionals: true; strict: true };

/** Typed result of {@link parseCommand}: values keyed by option name plus positionals. */
export type ParsedCommand<O extends OptionSpecs> = ReturnType<typeof parseArgs<StrictConfig<O>>>;

/**
 * Parses the arguments of one subcommand strictly (unknown options are errors).
 *
 * @param command Subcommand name, used in error hints.
 * @param argv Arguments after the subcommand.
 * @param options Option table; every command also declares `help`.
 * @throws UsageError for unknown options or missing option values.
 */
export function parseCommand<const O extends OptionSpecs>(
  command: string,
  argv: string[],
  options: O,
): ParsedCommand<O> {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(describeParseError(error), `Run "swarmloom ${command} --help" for usage.`);
  }
}

function describeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown }).code;
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    const option = /'([^']+)'/.exec(message)?.[1];
    if (option) return `Unknown option ${option}`;
  }
  // node:util messages are verbose; keep the first sentence.
  return message.split(". ")[0] ?? message;
}

const INT_RE = /^[+-]?\d+$/;
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Reads an integer option within [min, max].
 * @throws UsageError when `raw` is not an integer or out of range.
 */
export function readInt(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = INT_RE.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new UsageError(`--${name} must be an integer from ${min} to ${max} (got "${raw}")`);
  }
  return value;
}

/**
 * Reads a decimal option within (min, max] when `exclusiveMin`, else [min, max].
 * @throws UsageError when `raw` is not a plain decimal number or out of range.
 */
export function readNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
  range: { min: number; max: number; exclusiveMin?: boolean },
): number {
  if (raw === undefined) return fallback;
  const value = NUMBER_RE.test(raw.trim()) ? Number(raw) : Number.NaN;
  const tooLow = range.exclusiveMin ? value <= range.min : value < range.min;
  if (!Number.isFinite(value) || tooLow || value > range.max) {
    const lower = range.exclusiveMin ? `greater than ${range.min}` : `at least ${range.min}`;
    throw new UsageError(`--${name} must be a number ${lower} and at most ${range.max} (got "${raw}")`);
  }
  return value;
}

/**
 * Reads an option restricted to a fixed set of words.
 * @throws UsageError listing the allowed values.
 */
export function readEnum<const T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: NoInfer<T>,
): T {
  if (raw === undefined) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new UsageError(`--${name} must be one of ${allowed.join(", ")} (got "${raw}")`);
}

/**
 * Ensures exactly `count` positional arguments are present.
 * @throws UsageError naming what is missing or extra.
 */
export function expectPositionals(command: string, positionals: string[], names: readonly string[]): string[] {
  if (positionals.length < names.length) {
    throw new UsageError(
      `Missing ${names.slice(positionals.length).join(" ")}`,
      `Run "swarmloom ${command} --help" for usage.`,
    );
  }
  if (positionals.length > names.length) {
    throw new UsageError(`Unexpected argument "${positionals[names.length]}"`, `Run "swarmloom ${command} --help".`);
  }
  return positionals;
}
