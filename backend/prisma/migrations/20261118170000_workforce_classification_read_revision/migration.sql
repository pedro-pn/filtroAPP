-- Keep the new audit source covered by the shared derived-read revision contract.
CREATE TRIGGER performance_read_revision
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public."WorkforceClassificationEvent"
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_performance_read_revision();
