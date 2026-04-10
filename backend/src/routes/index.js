import { Router } from 'express';

import authRouter from './resources/auth.js';
import collaboratorsRouter from './resources/collaborators.js';
import countersRouter from './resources/counters.js';
import draftsRouter from './resources/drafts.js';
import equipmentRouter from './resources/equipment.js';
import manometersRouter from './resources/manometers.js';
import projectsRouter from './resources/projects.js';
import reportsRouter from './resources/reports.js';
import unitsRouter from './resources/units.js';
import uploadsRouter from './resources/uploads.js';
import usersRouter from './resources/users.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/collaborators', collaboratorsRouter);
router.use('/projects', projectsRouter);
router.use('/reports', reportsRouter);
router.use('/equipment', equipmentRouter);
router.use('/units', unitsRouter);
router.use('/manometers', manometersRouter);
router.use('/particle-counters', countersRouter);
router.use('/drafts', draftsRouter);
router.use('/uploads', uploadsRouter);
router.use('/users', usersRouter);

export default router;
