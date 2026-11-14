// Isomorphic root export: types and provider interfaces only. Node-only modules
// (db, queue, storage) live under their own subpaths so a browser bundle never
// reaches them (01.5-backend-foundation design, "Monorepo Changes").
// Domain logic (goal engine, capture, search) lands in later specs.
export * from './providers/types'
