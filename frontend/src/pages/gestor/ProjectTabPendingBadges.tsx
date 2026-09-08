import { pluralSuffix } from './commercialPendencias';

export function ProjectTabPendingBadges({
  pendingProjectRegistrationCount,
  pendingCommercialProposalCount
}: {
  pendingProjectRegistrationCount: number;
  pendingCommercialProposalCount: number;
}) {
  return (
    <>
      {pendingProjectRegistrationCount ? (
        <span
          className="nav-tab-count"
          title="Cadastros pendentes"
          aria-label={`${pendingProjectRegistrationCount} cadastro${pluralSuffix(pendingProjectRegistrationCount)} pendente${pluralSuffix(pendingProjectRegistrationCount)}`}
        >
          {pendingProjectRegistrationCount}
        </span>
      ) : null}
      {pendingCommercialProposalCount ? (
        <span
          className="nav-tab-count nav-tab-count-commercial"
          title="Propostas comerciais pendentes"
          aria-label={`${pendingCommercialProposalCount} proposta${pluralSuffix(pendingCommercialProposalCount)} comercial${pluralSuffix(pendingCommercialProposalCount, 'is')} pendente${pluralSuffix(pendingCommercialProposalCount)}`}
        >
          {pendingCommercialProposalCount}
        </span>
      ) : null}
    </>
  );
}
