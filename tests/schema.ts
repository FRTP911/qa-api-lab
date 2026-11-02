import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { expect } from 'vitest';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

export function expectSchema(data: unknown, schema: object) {
  const validate = ajv.compile(schema);
  validate(data);
  expect(validate.errors ?? []).toEqual([]);
}
