import { lazy, Suspense } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { canOpenDatabook } from '../../utils/databook';
import { Button } from '../ui/ds';
import { ProjectDatabookNovelty } from './ProjectDatabookNovelty';

const ProjectDatabookDialog = lazy(() => import('./ProjectDatabookDialog'));

export function ProjectDatabookButton({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const location = useLocation(); const navigate = useNavigate();
  if (!canOpenDatabook(user)) return null;
  return <Button variant="secondary" size="sm" type="button" data-project-databook aria-haspopup="dialog" onClick={() => {
    const params = new URLSearchParams(location.search); params.set('databook', projectId); params.delete('databookMode');
    navigate(`${location.pathname}?${params}`);
  }}>Databook</Button>;
}

export function ProjectDatabookHost() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const projectId = params.get('databook');
  if (!canOpenDatabook(user)) return null;
  return <>
    {!projectId ? <ProjectDatabookNovelty userId={user!.id} /> : null}
    {projectId ? <Suspense fallback={null}><ProjectDatabookDialog key={projectId} projectId={projectId} userId={user!.id} onClose={() => {
      setParams(current => { const next = new URLSearchParams(current); next.delete('databook'); next.delete('databookMode'); return next; }, { replace: true });
    }} /></Suspense> : null}
  </>;
}
