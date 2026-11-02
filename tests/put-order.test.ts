import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { login, makeOrderPayload } from './helpers';
import { orderSchema } from './schemas/order.schema';
import { expectSchema } from './schema';

type App = ReturnType<typeof createApp>;

interface OrderBody {
  id: string;
  tier: string;
  subtotal: number;
  total: number;
  createdAt: string;
  items: { sku: string; price: number; qty: number }[];
}

const replacement = {
  items: [{ sku: 'SKU-B', price: 1000, qty: 2 }],
};

async function createOrder(app: App, token: string): Promise<OrderBody> {
  const res = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send(makeOrderPayload());
  expect(res.status).toBe(201);
  return res.body as OrderBody;
}

describe('PUT /orders/:id — повна заміна позицій (варіант 5)', () => {
  let app: App;
  let token: string;
  let auth: { Authorization: string };

  beforeEach(async () => {
    app = createApp();
    token = await login(app, 'bob@example.com'); // basic
    auth = { Authorization: `Bearer ${token}` };
  });

  it('замінює позиції: 200, Content-Type, схема, перерахована сума', async () => {
    const created = await createOrder(app, token);

    const res = await request(app)
      .put(`/orders/${created.id}`)
      .set(auth)
      .send(replacement);

    expect(res.status).toBe(200); // рівень 1
    expect(res.headers['content-type']).toMatch(/application\/json/); // рівень 4
    expectSchema(res.body, orderSchema); // рівень 2

    // рівень 3: 1000 * 2 = 2000; basic 0% + 5% за суму >= 2000; доставка безкоштовна
    expect(res.body.subtotal).toBeCloseTo(2000, 2);
    expect(res.body.total).toBeCloseTo(1900, 2);
    expect(res.body.items).toEqual(replacement.items);
    expect(res.body.id).toBe(created.id);
    expect(res.body.createdAt).toBe(created.createdAt);
  });

  it('побічний ефект: GET повертає замінені позиції, старих більше немає', async () => {
    const created = await createOrder(app, token);

    const updated = await request(app)
      .put(`/orders/${created.id}`)
      .set(auth)
      .send(replacement);
    expect(updated.status).toBe(200); // рівень 5: перевіряємо наступним запитом

    const fetched = await request(app).get(`/orders/${created.id}`).set(auth);

    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(updated.body);
    expect(fetched.body.items).toEqual(replacement.items);
    expect(fetched.body.items.some((i: { sku: string }) => i.sku === 'SKU-A')).toBe(false);
    expect(fetched.body.total).toBeCloseTo(1900, 2);
  });

  it('ідемпотентність: три однакові PUT дають однакове тіло і не створюють дублікатів', async () => {
    const created = await createOrder(app, token);
    const url = `/orders/${created.id}`;

    const first = await request(app).put(url).set(auth).send(replacement);
    const second = await request(app).put(url).set(auth).send(replacement);
    const third = await request(app).put(url).set(auth).send(replacement);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    expect(third.body.id).toBe(created.id);
    expect(third.body.total).toBeCloseTo(1900, 2);

    const list = await request(app).get('/orders').set(auth);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(created.id);
  });

  it.each([
    { name: 'порожній список', body: { items: [] }, code: 'EMPTY_ORDER' },
    { name: 'відсутнє поле items', body: {}, code: 'EMPTY_ORDER' },
    { name: 'items не масив', body: { items: 'SKU-A' }, code: 'EMPTY_ORDER' },
    { name: 'від’ємна ціна', body: { items: [{ sku: 'A', price: -1, qty: 1 }] }, code: 'INVALID_PRICE' },
    { name: 'ціна не число', body: { items: [{ sku: 'A', price: '10', qty: 1 }] }, code: 'INVALID_PRICE' },
    { name: 'нульова кількість', body: { items: [{ sku: 'A', price: 10, qty: 0 }] }, code: 'INVALID_QTY' },
    { name: 'дробова кількість', body: { items: [{ sku: 'A', price: 10, qty: 1.5 }] }, code: 'INVALID_QTY' },
    { name: 'рядкова кількість', body: { items: [{ sku: 'A', price: 10, qty: '1' }] }, code: 'INVALID_QTY' },
  ])('параметризована валідація: $name → 400 $code', async ({ body, code }) => {
    const created = await createOrder(app, token);

    const res = await request(app)
      .put(`/orders/${created.id}`)
      .set(auth)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);

    const fetched = await request(app).get(`/orders/${created.id}`).set(auth);
    expect(fetched.body.total).toBeCloseTo(560, 2);
    expect(fetched.body.items).toEqual(makeOrderPayload().items);
  });

  it.each([
    { name: 'без токена', header: undefined },
    { name: 'з підробленим токеном', header: 'Bearer invalid-token' },
    { name: 'без префікса Bearer', header: 'some-token' },
  ])('PUT $name → 401, замовлення не змінюється', async ({ header }) => {
    const created = await createOrder(app, token);

    const req = request(app).put(`/orders/${created.id}`).send(replacement);
    if (header) req.set('Authorization', header);
    const res = await req;

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');

    const fetched = await request(app).get(`/orders/${created.id}`).set(auth);
    expect(fetched.body).toEqual(created);
  });

  it('чуже замовлення → 404 (а не 403), дані власника не змінюються', async () => {
    const alice = await login(app, 'alice@example.com');
    const bob = await login(app, 'bob@example.com');
    const aliceOrder = await createOrder(app, alice);

    const res = await request(app)
      .put(`/orders/${aliceOrder.id}`)
      .set('Authorization', `Bearer ${bob}`)
      .send(replacement);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    const fetched = await request(app)
      .get(`/orders/${aliceOrder.id}`)
      .set('Authorization', `Bearer ${alice}`);
    expect(fetched.body).toEqual(aliceOrder);
  });

  it('неіснуюче замовлення → 404', async () => {
    const res = await request(app)
      .put('/orders/00000000-0000-0000-0000-000000000000')
      .set(auth)
      .send(replacement);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
