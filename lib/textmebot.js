// Envio de WhatsApp via TextMeBot (automação não-oficial, usando o número
// de WhatsApp que você já conectou lá pelo QR Code).

async function enviarWhatsappTextMeBot(numero, texto) {
  if (!numero) return { enviado: false, motivo: 'sem número de WhatsApp' };

  const url = `https://api.textmebot.com/send.php?recipient=${numero}&apikey=${process.env.TEXTMEBOT_APIKEY}&text=${encodeURIComponent(texto)}`;

  try {
    const resposta = await fetch(url);
    const corpo = await resposta.text();
    // O TextMeBot não retorna um JSON padronizado de sucesso/erro — só
    // registra a resposta bruta pra dar pra investigar se algo falhar.
    return { enviado: true, resposta: corpo };
  } catch (err) {
    return { enviado: false, motivo: err.message };
  }
}

module.exports = { enviarWhatsappTextMeBot };
