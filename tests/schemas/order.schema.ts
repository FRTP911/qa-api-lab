export const orderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    tier: { type: 'string', enum: ['basic', 'silver', 'gold'] },
    subtotal: { type: 'number', minimum: 0 },
    total: { type: 'number', minimum: 0 },
    createdAt: { type: 'string', format: 'date-time' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          sku: { type: 'string', minLength: 1 },
          price: { type: 'number', minimum: 0 },
          qty: { type: 'integer', minimum: 1 },
        },
        required: ['sku', 'price', 'qty'],
        additionalProperties: false,
      },
    },
  },
  required: ['id', 'tier', 'subtotal', 'total', 'createdAt', 'items'],
  additionalProperties: false,
} as const;
