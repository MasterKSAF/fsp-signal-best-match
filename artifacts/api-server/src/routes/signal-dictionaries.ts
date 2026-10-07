import { Router } from 'express';
import { SKILL_CATALOG, SKILL_CATALOG_VERSION } from '../lib/skill-catalog';
const router = Router();
router.get('/dictionaries/skills', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ version: SKILL_CATALOG_VERSION, skills: SKILL_CATALOG.map(({ id, label, aliases, programs, evidence }) => ({ id, label, aliases, programs, evidence })) });
});
export default router;
