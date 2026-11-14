// Every `/v1` route is registered here, before createApp() generates the
// OpenAPI document, so the document lists them all.
import { type OpenAPIHono } from '@hono/zod-openapi'
import { type AppBindings } from '../http/bindings'
import { type ApiDeps } from '../app'
import { registerMe } from './me'

export function registerRoutes(v1: OpenAPIHono<AppBindings>, deps: ApiDeps): void {
  registerMe(v1, deps)
}
