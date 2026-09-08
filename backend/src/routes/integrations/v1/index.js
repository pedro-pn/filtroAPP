import { Router } from 'express';

import env from '../../../config/env.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler, sendIntegrationError } from '../../../middleware/api-request-context.js';
import { coarseApiTokenIpLimit, requireApiToken } from '../../../middleware/api-token-auth.js';
import qualidadeRouter from './qualidade.js';
import operationalRouter from './operational.js';

const router = Router();

router.use(apiRequestContext());
router.use(integrationApiBoundary({ allowedOrigins: env.allowedOrigins, requireHttps: env.nodeEnv === 'production' }));
router.use(coarseApiTokenIpLimit);
router.use(requireApiToken);
router.use('/qualidade', qualidadeRouter);
router.use(operationalRouter);
router.use((req, res) => sendIntegrationError(res, req, 404, 'NOT_FOUND', 'Operação de integração não encontrada.'));
router.use(integrationApiErrorHandler);

export default router;
