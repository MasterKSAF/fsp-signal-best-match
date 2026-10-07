import { Router, type IRouter } from 'express';
import { loadPublicQualityReport } from '../lib/public-quality';

export function createQualityRouter(load = loadPublicQualityReport): IRouter {
  const router: IRouter = Router();
  // Both public endpoints share the checked aggregate, never private fixtures.
  router.get(['/quality/report', '/quality/evaluation'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(load());
  });
  return router;
}

export default createQualityRouter();
