-- Situação manual sem projeto; os registros de ponto permanecem preservados.
ALTER TYPE "AllocationReviewKind" ADD VALUE IF NOT EXISTS 'FALTA';
