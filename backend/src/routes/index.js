import { Router } from 'express';

import authRouter from './resources/auth.js';
import bootstrapRouter from './resources/bootstrap.js';
import collaboratorsRouter from './resources/collaborators.js';
import countersRouter from './resources/counters.js';
import draftsRouter from './resources/drafts.js';
import episRouter from './resources/epis.js';
import equipmentRouter from './resources/equipment.js';
import inhibitionOptionsRouter from './resources/inhibition-options.js';
import manometersRouter from './resources/manometers.js';
import projectSegmentsRouter from './resources/project-segments.js';
import privacyRouter from './resources/privacy.js';
import projectsRouter from './resources/projects.js';
import reportsRouter from './resources/reports.js';
import romaneiosRouter from './resources/romaneios.js';
import statisticsRouter from './resources/statistics.js';
import surveysRouter from './resources/surveys.js';
import unitsRouter from './resources/units.js';
import uploadsRouter from './resources/uploads.js';
import usersRouter from './resources/users.js';

const router = Router();

function mountRdoRoutes(targetRouter) {
  targetRouter.use('/bootstrap', bootstrapRouter);
  targetRouter.use('/collaborators', collaboratorsRouter);
  targetRouter.use('/projects', projectsRouter);
  targetRouter.use('/project-segments', projectSegmentsRouter);
  targetRouter.use('/reports', reportsRouter);
  targetRouter.use('/statistics', statisticsRouter);
  targetRouter.use('/surveys', surveysRouter);
  targetRouter.use('/equipment', equipmentRouter);
  targetRouter.use('/inhibition-options', inhibitionOptionsRouter);
  targetRouter.use('/units', unitsRouter);
  targetRouter.use('/manometers', manometersRouter);
  targetRouter.use('/particle-counters', countersRouter);
  targetRouter.use('/drafts', draftsRouter);
  targetRouter.use('/uploads', uploadsRouter);
}

const rdoRouter = Router();
mountRdoRoutes(rdoRouter);

router.use('/auth', authRouter);
router.use('/privacy', privacyRouter);
router.use('/rdo', rdoRouter);
router.use('/romaneio', romaneiosRouter);
router.use('/epi', episRouter);
router.use('/admin/accounts', usersRouter);
router.use('/users', usersRouter);
mountRdoRoutes(router);

export default router;
