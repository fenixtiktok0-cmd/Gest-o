const URL_PADRAO = 'https://x.fenixsocial.site/api/monitoramento';

async function chamarMultiflix(acao, usuario, extras = {}) {
  const segredo = String(process.env.MULTIFLIX_RENOVACAO_SECRET || '');
  if (!segredo) throw new Error('A integração de renovação MultiFlix está em configuração.');
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 10000);
  try {
    const resposta = await fetch(process.env.MULTIFLIX_RENOVACAO_URL || URL_PADRAO, {
      method: 'POST', signal: controlador.signal,
      headers: { 'Content-Type': 'application/json', 'x-multiflix-renovacao-secret': segredo },
      body: JSON.stringify({ acao, usuario, ...extras }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível consultar o MultiFlix agora.');
    return dados;
  } finally { clearTimeout(timeout); }
}

const consultarRenovacaoMultiflix = (usuario) => chamarMultiflix('consultar', usuario);
const renovarNoMultiflix = (usuario, pagamentoId) => chamarMultiflix('renovar', usuario, { pagamentoId });

module.exports = { consultarRenovacaoMultiflix, renovarNoMultiflix };
