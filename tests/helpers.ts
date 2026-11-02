import request from 'supertest';
import type { Express } from 'express';

export async function login(app: Express, email: string): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ email, password: 'Secret123' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.body.accessToken;
}

export function makeOrderPayload(overrides: Partial<{ items: unknown }> = {}) {
  return { items: [{ sku: 'SKU-A', price: 500, qty: 1 }], ...overrides };
}
