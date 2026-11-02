import express from 'express';
import { randomUUID } from 'node:crypto';

type Tier = 'basic' | 'silver' | 'gold';
interface Item {
  sku: string;
  price: number;
  qty: number;
}
interface Order {
  id: string;
  ownerId: string;
  tier: Tier;
  items: Item[];
  subtotal: number;
  total: number;
  createdAt: string;
}

const USERS = [
  { id: 'u1', email: 'alice@example.com', password: 'Secret123', tier: 'gold' as Tier },
  { id: 'u2', email: 'bob@example.com', password: 'Secret123', tier: 'basic' as Tier },
];
const DISCOUNT: Record<Tier, number> = { basic: 0, silver: 0.05, gold: 0.1 };
const round2 = (n: number) => Math.round(n * 100) / 100;

function toPublic({ ownerId, ...rest }: Order) {
  return rest;
}

type ItemsResult = { ok: true; items: Item[] } | { ok: false; code: string };

function validateItems(input: unknown): ItemsResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, code: 'EMPTY_ORDER' };
  }
  for (const i of input as Item[]) {
    if (!i || typeof i.price !== 'number' || Number.isNaN(i.price) || i.price < 0) {
      return { ok: false, code: 'INVALID_PRICE' };
    }
    if (!Number.isInteger(i.qty) || i.qty <= 0) {
      return { ok: false, code: 'INVALID_QTY' };
    }
  }
  return { ok: true, items: input as Item[] };
}

function calculateTotals(items: Item[], tier: Tier) {
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  let rate = DISCOUNT[tier];
  if (subtotal >= 2000) rate += 0.05;
  const afterDiscount = round2(subtotal * (1 - Math.min(rate, 0.25)));
  const total = round2(afterDiscount + (afterDiscount >= 1000 ? 0 : 60));
  return { subtotal, total };
}

export function createApp() {
  const app = express();
  app.use(express.json());
  const tokens = new Map<string, string>();
  const orders = new Map<string, Order>();

  app.post('/auth/login', (req, res) => {
    const user = USERS.find(
      (u) => u.email === req.body?.email && u.password === req.body?.password,
    );
    if (!user) return res.status(401).json({ code: 'INVALID_CREDENTIALS' });
    const token = randomUUID();
    tokens.set(token, user.id);
    res.json({ accessToken: token });
  });

  app.use('/orders', (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const userId = token ? tokens.get(token) : undefined;
    if (!userId) return res.status(401).json({ code: 'UNAUTHORIZED' });
    res.locals.user = USERS.find((u) => u.id === userId);
    next();
  });

  app.post('/orders', (req, res) => {
    const parsed = validateItems(req.body?.items);
    if (!parsed.ok) return res.status(400).json({ code: parsed.code });

    const user = res.locals.user;
    const { subtotal, total } = calculateTotals(parsed.items, user.tier as Tier);

    const order: Order = {
      id: randomUUID(),
      ownerId: user.id,
      tier: user.tier,
      items: parsed.items,
      subtotal,
      total,
      createdAt: new Date().toISOString(),
    };
    orders.set(order.id, order);
    res.status(201).location(`/orders/${order.id}`).json(toPublic(order));
  });

  // Variant 5: full replacement of order items with recalculation.
  app.put('/orders/:id', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order || order.ownerId !== res.locals.user.id) {
      return res.status(404).json({ code: 'NOT_FOUND' });
    }

    const parsed = validateItems(req.body?.items);
    if (!parsed.ok) return res.status(400).json({ code: parsed.code });

    const user = res.locals.user;
    const { subtotal, total } = calculateTotals(parsed.items, user.tier as Tier);

    const updated: Order = {
      ...order,
      items: parsed.items,
      subtotal,
      total,
    };
    orders.set(updated.id, updated);
    res.json(toPublic(updated));
  });

  app.get('/orders', (_req, res) => {
    const mine = [...orders.values()].filter((o) => o.ownerId === res.locals.user.id);
    res.json(mine.map(toPublic));
  });

  app.get('/orders/:id', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order || order.ownerId !== res.locals.user.id) {
      return res.status(404).json({ code: 'NOT_FOUND' });
    }
    res.json(toPublic(order));
  });

  app.delete('/orders/:id', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order || order.ownerId !== res.locals.user.id) {
      return res.status(404).json({ code: 'NOT_FOUND' });
    }
    orders.delete(order.id);
    res.status(204).end();
  });

  return app;
}
