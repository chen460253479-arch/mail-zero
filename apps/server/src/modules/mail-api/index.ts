export { registerMailBlobRoutes } from './http';
export { mailApiRouter } from './router';
export type MailApiRouter = typeof import('./router').mailApiRouter;
