// Entende links M3U no formato Xtream Codes e consulta o painel de origem
// pra puxar usuário, senha e data de vencimento automaticamente.

function parsearLinkM3U(link) {
  try {
    const url = new URL(link.trim());
    const usuario = url.searchParams.get('username');
    const senha = url.searchParams.get('password');
    if (!usuario || !senha) return null;

    return {
      baseUrl: `${url.protocol}//${url.host}`,
      usuario,
      senha,
    };
  } catch (err) {
    return null;
  }
}

async function consultarContaXtream(link) {
  const dados = parsearLinkM3U(link);
  if (!dados) {
    return { erro: 'Link M3U inválido — não consegui extrair usuário/senha dele.' };
  }

  const apiUrl = `${dados.baseUrl}/player_api.php?username=${encodeURIComponent(dados.usuario)}&password=${encodeURIComponent(dados.senha)}`;

  let resposta;
  try {
    resposta = await fetch(apiUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
    });
  } catch (err) {
    return { erro: `Não consegui conectar no painel (${err.message}). Confirma se o link está certo e o painel está no ar.` };
  }

  if (!resposta.ok) {
    let corpoResposta = '';
    try { corpoResposta = (await resposta.text()).slice(0, 200); } catch (e) {}
    return { erro: `O painel respondeu com erro (status ${resposta.status}). ${corpoResposta ? 'Resposta: ' + corpoResposta : ''}` };
  }

  let json;
  try {
    json = await resposta.json();
  } catch (err) {
    return { erro: 'O painel não devolveu um formato reconhecido (esperava JSON do player_api.php).' };
  }

  const info = json.user_info || json;
  if (!info || (!info.exp_date && !info.status)) {
    return { erro: 'O painel respondeu, mas não veio com os dados esperados (exp_date/status). Pode ser um painel com formato diferente.' };
  }

  const vencimento = info.exp_date ? Number(info.exp_date) * 1000 : null;

  return {
    usuario: dados.usuario,
    senha: dados.senha,
    vencimento,
    statusPainel: info.status || null,
    baseUrl: dados.baseUrl,
  };
}

module.exports = { parsearLinkM3U, consultarContaXtream };
