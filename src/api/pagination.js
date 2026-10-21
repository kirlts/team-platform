// Paginación uniforme de toda lista: ?page=&limit= con tope de 100, respuesta { items, page, limit, total }.

export const pageQuerySchema = (config) => ({
  page: { type: 'integer', minimum: 1 },
  limit: { type: 'integer', minimum: 1, maximum: config.list.pageMax }
})

export function pageParams (query, config) {
  const page = query.page ?? 1
  const limit = query.limit ?? config.list.pageSize
  return { page, limit, offset: (page - 1) * limit }
}

export const pageEnvelope = (itemSchema) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: itemSchema },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' }
  }
})

export const pageResult = (items, total, { page, limit }) => ({ items, page, limit, total })
