/** Faz a próxima etapa começar no topo visível do formulário. */
export function rolarParaInicioDoFormulario(
  elemento: Pick<Element, 'scrollIntoView'> | null
) {
  elemento?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Leva o usuário ao primeiro controle que a validação marcou na seção aberta.
 *
 * Alguns erros pertencem a um grupo (checkboxes, tabelas) e deixam o
 * `aria-invalid` no contêiner. Nesses casos o foco vai para o primeiro controle
 * editável dentro dele, enquanto a rolagem mantém o grupo e a mensagem visíveis.
 */
export function focarPrimeiroCampoInvalido(raiz: ParentNode | null): boolean {
  const invalido = raiz?.querySelector<HTMLElement>('[aria-invalid="true"]')
    ?? raiz?.querySelector<HTMLElement>('[data-custo-pendencias]');
  if (!invalido) return false;

  // Jornadas usam <details>; fases minimizadas mantêm os campos em um bloco
  // hidden. Abrir seus controles antes de focar evita rolar para um campo invisível.
  let aguardarExpansao = false;
  for (let pai = invalido.parentElement; pai; pai = pai.parentElement) {
    if (pai.tagName === 'DETAILS') (pai as HTMLDetailsElement).open = true;
    if (pai.hidden && pai.id) {
      const id = pai.id;
      const botao = [...(raiz?.querySelectorAll<HTMLButtonElement>('button[aria-controls]') ?? [])]
        .find(item => item.getAttribute('aria-controls') === id);
      if (botao?.getAttribute('aria-expanded') === 'false') {
        botao.click();
        aguardarExpansao = true;
      }
    }
  }

  const seletorDeControle =
    'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)';
  const controleEditavel = invalido.matches(seletorDeControle)
    ? invalido
    : invalido.querySelector<HTMLElement>(seletorDeControle);
  const controle = controleEditavel ?? invalido;
  if (!controleEditavel) controle.tabIndex = -1;

  const focar = () => {
    controle.focus({ preventScroll: true });
    invalido.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  if (aguardarExpansao) window.requestAnimationFrame(focar);
  else focar();
  return true;
}

/**
 * Monta o endereço depois de salvar e avançar no levantamento.
 *
 * No primeiro avanço, o `id` acabou de nascer no POST e ainda não existe nos
 * parâmetros capturados pelo render atual. Montar os dois valores junto evita
 * que a troca de seção apague esse id por usar uma fotografia antiga da URL.
 */
export function parametrosDoLevantamentoAposAvanco(
  atuais: URLSearchParams,
  secao: string,
  levantamentoId = ''
): URLSearchParams {
  const proximos = new URLSearchParams(atuais);
  proximos.set('secao', secao);
  if (levantamentoId) proximos.set('id', levantamentoId);
  return proximos;
}
