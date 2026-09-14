// Envio de WhatsApp via TextMeBot (automação não-oficial, usando o número
// de WhatsApp que você já conectou lá pelo QR Code).

async function enviarWhatsappTextMeBot(numero, texto) {
  if (!numero) return { enviado: false, motivo: 'sem número de WhatsApp' };
  const chave = String(process.env.TEXTMEBOT_APIKEY || '').trim();
  if (!chave) return { enviado: false, motivo: 'serviço de WhatsApp não configurado' };

  const parametros = new URLSearchParams({
    recipient: String(numero),
    apikey: chave,
    text: String(texto),
    json: 'yes',
  });
  const url = `https://api.textmebot.com/send.php?${parametros}`;
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), 15000);

  try {
    const resposta = await fetch(url, { signal: controlador.signal });
    const corpo = await resposta.text();
    let dados = null;
    try { dados = JSON.parse(corpo); } catch (_) { /* resposta inválida */ }

    const confirmado = resposta.ok && (
      dados?.status === 'success' ||
      /(?:result:\s*<b>\s*success|message sent)/i.test(corpo)
    );
    if (!confirmado) {
      console.error('[TextMeBot] envio não confirmado:', resposta.status);
      return { enviado: false, motivo: 'o provedor não confirmou o envio' };
    }
    return { enviado: true };
  } catch (err) {
    console.error('[TextMeBot] falha no envio:', err.name);
    return { enviado: false, motivo: err.name === 'AbortError' ? 'tempo de envio esgotado' : 'falha de comunicação' };
  } finally {
    clearTimeout(limite);
  }
}

module.exports = { enviarWhatsappTextMeBot };
