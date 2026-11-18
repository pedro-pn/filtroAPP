// Política de senha compartilhada entre backend e frontend.
// Vale para senhas NOVAS (criação, troca, redefinição e definição pelo admin).
// O login não aplica este mínimo: contas antigas com senha curta continuam
// entrando e passam a cumprir a regra na próxima troca.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MIN_LENGTH_MESSAGE = `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
