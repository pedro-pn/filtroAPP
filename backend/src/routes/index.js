import { Router } from 'express';

import authRouter from './resources/auth.js';
import collaboratorsRouter from './resources/collaborators.js';
import countersRouter from './resources/counters.js';
import draftsRouter from './resources/drafts.js';
import equipmentRouter from './resources/equipment.js';
import manometersRouter from './resources/manometers.js';
import projectSegmentsRouter from './resources/project-segments.js';
import projectsRouter from './resources/projects.js';
import reportsRouter from './resources/reports.js';
import statisticsRouter from './resources/statistics.js';
import surveysRouter from './resources/surveys.js';
import unitsRouter from './resources/units.js';
import uploadsRouter from './resources/uploads.js';
import usersRouter from './resources/users.js';
import webhooksRouter from './resources/webhooks.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/collaborators', collaboratorsRouter);
router.use('/projects', projectsRouter);
router.use('/project-segments', projectSegmentsRouter);
router.use('/reports', reportsRouter);
router.use('/statistics', statisticsRouter);
router.use('/surveys', surveysRouter);
router.use('/equipment', equipmentRouter);
router.use('/units', unitsRouter);
router.use('/manometers', manometersRouter);
router.use('/particle-counters', countersRouter);
router.use('/drafts', draftsRouter);
router.use('/uploads', uploadsRouter);
router.use('/users', usersRouter);
router.use('/webhooks', webhooksRouter);

export default router;
