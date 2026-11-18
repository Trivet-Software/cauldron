// Every `/v1` route is registered here, before createApp() generates the
// OpenAPI document, so the document lists them all.
import { type OpenAPIHono } from '@hono/zod-openapi'
import { type AppBindings } from '../http/bindings'
import { type ApiDeps } from '../app'
import { registerCaptures } from './captures'
import { registerGoals } from './goals'
import { registerItems } from './items'
import { registerMe } from './me'
import { registerSources } from './sources'

export function registerRoutes(v1: OpenAPIHono<AppBindings>, deps: ApiDeps): void {
  registerMe(v1, deps)
  registerGoals(v1, deps)
  registerCaptures(v1, deps)
  registerSources(v1, deps)
  registerItems(v1, deps)
}
