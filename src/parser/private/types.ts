import { RetentionPolicy } from '../template';

export class ParserError extends Error {
  constructor(msg: string) {
    super(msg);
    Object.setPrototypeOf(this, ParserError.prototype);
  }
}

export function parseNumber(asString: string | number) {
  const asNumber = parseInt(`${asString}`, 10);
  if (`${asNumber}` !== `${asString}`) {
    throw new ParserError(`Not a number: ${asString}`);
  }
  return { asString: `${asNumber}`, asNumber };
}

export function assertString(x: unknown): string {
  if (typeof x === 'number') {
    return `${x}`;
  }
  if (typeof x === 'string') {
    return x;
  }
  throw new ParserError(`Expected string, got: ${JSON.stringify(x)}`);
}

export function assertNumber(x: unknown): number {
  if (typeof x === 'number') {
    return x;
  }
  if (typeof x === 'string') {
    return parseNumber(x).asNumber;
  }
  throw new ParserError(`Expected number, got: ${JSON.stringify(x)}`);
}

export function assertList<T = unknown>(x: unknown, lengths?: number[]): T[] {
  if (!Array.isArray(x)) {
    throw new ParserError(`Expected list, got: ${JSON.stringify(x)}`);
  }
  if (lengths && !lengths.includes(x.length)) {
    throw new ParserError(
      `Expected list of length ${lengths}, got ${x.length}`
    );
  }
  return x;
}

export function assertListOfForm<T>(
  x: unknown,
  assertForm: (e: unknown) => T,
  form?: string
): T[] {
  try {
    return assertList(x).map(assertForm);
  } catch (e) {
    if (form) {
      throw new ParserError(
        `Expected list of form ${form}, got: ${JSON.stringify(x)}`
      );
    }

    throw e;
  }
}

export function assertBoolean(x: unknown): boolean {
  if (typeof x === 'boolean') {
    return x;
  }

  switch (x) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      throw new ParserError(`Expected boolean, got: ${JSON.stringify(x)}`);
  }
}

export function assertTrue(x: unknown): true {
  assertBoolean(x);
  if (x !== true) {
    throw new ParserError(`Expected 'true', got: ${JSON.stringify(x)}`);
  }
  return x;
}

export function assertObject(x: unknown): Record<string, unknown> {
  if (typeof x !== 'object' || x == null || Array.isArray(x)) {
    throw new ParserError(`Expected object, got: ${JSON.stringify(x)}`);
  }
  return x as any;
}

export function assertField<A extends object, K extends keyof A>(
  xs: A,
  fieldName: K
): unknown {
  if (!(fieldName in xs)) {
    throw new ParserError(`Expected field named '${String(fieldName)}'`);
  }
  return xs[fieldName];
}
export function assertOneOf<A extends unknown>(x: A, allowed: unknown[]): A {
  if (!allowed.includes(x)) {
    throw new ParserError(
      `Expected one of ${allowed
        .map((f) => `'${String(f)}'`)
        .join('|')}, got: ${JSON.stringify(x)}`
    );
  }
  return x;
}

export function assertExactlyOneOfFields<A extends object, K extends keyof A>(
  xs: A,
  fieldNames: K[]
): K {
  const foundFields = fieldNames.filter((f) => f in xs);
  if (foundFields.length !== 1) {
    throw new ParserError(
      `Expected exactly one of the fields ${fieldNames
        .map((f) => `'${String(f)}'`)
        .join(', ')}, got: ${JSON.stringify(xs)}`
    );
  }
  return foundFields[0];
}

export function assertAtMostOneOfFields<A extends object, K extends keyof A>(
  xs: A,
  fieldNames: K[]
): K | undefined {
  const foundFields = fieldNames.filter((f) => f in xs);
  if (foundFields.length > 1) {
    throw new ParserError(
      `Expected at most one of the fields ${fieldNames
        .map((f) => `'${String(f)}'`)
        .join(', ')}, got: ${JSON.stringify(xs)}`
    );
  }
  return foundFields[0];
}

export function assertOneField(xs: unknown): string {
  const fields = Object.keys(assertObject(xs));
  if (fields.length !== 1) {
    throw new ParserError(
      `Expected exactly one field, got: ${JSON.stringify(xs)}`
    );
  }
  return fields[0];
}

export function assertStringOrListIntoList(x: unknown): string[] {
  if (typeof x === 'string') {
    return [x];
  }
  if (Array.isArray(x)) {
    const nonStrings = x.filter((y) => typeof y !== 'string');
    if (nonStrings.length > 0) {
      throw new ParserError(
        `Expected all strings in array, found: ${nonStrings}`
      );
    }
    return x as string[];
  }
  throw new ParserError(
    `Expected string or list of strings, got: ${JSON.stringify(x)}`
  );
}

export function singletonList(x: string | undefined) {
  return x ? [x] : [];
}

export function parseRetentionPolicy(x: unknown): RetentionPolicy {
  switch (x) {
    case 'Delete':
      return 'Delete';
    case 'Retain':
      return 'Retain';
    case 'Snapshot':
      return 'Snapshot';
  }

  throw new ParserError(
    `Expected one of Delete|Retain|Snapshot, got: ${JSON.stringify(x)}`
  );
}

export function mapFromObject<A>(
  xs: unknown,
  fn: (x: unknown) => A
): Map<string, A> {
  return new Map(
    Object.entries(assertObject(xs)).map(([k, v]) => [k, fn(v as any)])
  );
}

export function assertOr<T>(
  x: unknown,
  error: (v: string) => string,
  ...assertions: Array<(e: unknown) => T>
) {
  for (const assertion of assertions) {
    try {
      return assertion(x);
    } catch {}
  }

  throw new ParserError(error(JSON.stringify(x)));
}

export function assertStringOrStringList(xs: unknown): string | string[] {
  return assertOr<string | string[]>(
    xs,
    (v) => `Expected string or list of strings, got: ${v}`,
    assertString,
    assertList
  );
}
