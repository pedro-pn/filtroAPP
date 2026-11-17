-- RH source/mapping changes join the transactional derived-read revision.
-- Receipt polling and feed checkpoints are operational metadata; they do not
-- invalidate financial responses. Canonical collaborators, roles and salaries
-- already have their own source triggers.
CREATE TRIGGER performance_read_revision
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public."ConectaRhAggregate"
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_performance_read_revision();

CREATE TRIGGER performance_read_revision
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public."ConectaRhPerson"
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_performance_read_revision();
