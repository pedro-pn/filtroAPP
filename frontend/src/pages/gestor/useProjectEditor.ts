import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import type { Project } from '../../types/domain';
import { emptyProjectForm, projectToForm, type ProjectFormState } from './GestorPage.shared';

export function useProjectEditor(projects: Project[] | undefined, projectsTab: boolean, clearSearch: (value: string) => void) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const projectReviewId = projectsTab ? searchParams.get('revisar') : null;
  const openedReviewRef = useRef<string | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [projectEditingId, setProjectEditingId] = useState<string | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);

  useEffect(() => {
    const reviewKey = `${location.key}:${projectReviewId}`;
    if (!projectReviewId || openedReviewRef.current === reviewKey) return;
    const project = projects?.find(item => item.id === projectReviewId);
    if (!project) return;
    openedReviewRef.current = reviewKey;
    clearSearch('');
    setProjectEditingId(project.id);
    setShowProjectForm(true);
    setProjectForm(projectToForm(project));
  }, [projectReviewId, projects, location.key, clearSearch]);

  function resetProjectForm() {
    setProjectForm(emptyProjectForm);
    setProjectEditingId(null);
    setShowProjectForm(false);
  }

  function toggleProjectEdit(project: Project) {
    if (projectEditingId === project.id) {
      resetProjectForm();
      return;
    }
    setProjectEditingId(project.id);
    setShowProjectForm(true);
    setProjectForm(projectToForm(project));
  }

  return { projectForm, setProjectForm, projectEditingId, setProjectEditingId, showProjectForm, setShowProjectForm, projectReviewId, resetProjectForm, toggleProjectEdit };
}
