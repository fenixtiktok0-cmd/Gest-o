// Integração com o Mercado Pago — PIX avulso (não recorrente), usado pra
// cobrar o cliente quando o teste vira oficial.

const MP_API = 'https://api.mercadopago.com';

async function mpFetch(caminho, opcoes = {}) {
  const resposta = await fetch(`${MP_API}${caminho}`, {
    ...opcoes,
    headers: {
      'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  });
  const dados = await resposta.json();
  if (!resposta.ok) {
    const erro = new Error(dados.message || 'Erro na API do Mercado Pago');
    erro.detalhes = dados;
    throw erro;
  }
  return dados;
}

// Gera uma cobrança PIX avulsa pro cliente — o código muda a cada geração,
// e não fica vinculado a nenhuma assinatura recorrente.
async function criarPagamentoPix({ clienteId, email, valor, descricao }) {
  const chaveIdempotencia = `pix-cliente-${clienteId}-${Date.now()}`;
  const resultado = await mpFetch('/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': chaveIdempotencia },
    body: JSON.stringify({
      transaction_amount: Number(valor),
      description: descricao || 'Ativação do plano',
      payment_method_id: 'pix',
      payer: { email: email || 'cliente@sememail.com' },
      external_reference: clienteId,
      notification_url: `${process.env.APP_URL}/api/webhook-mercadopago`,
    }),
  });

  const dadosPix = resultado.point_of_interaction?.transaction_data || {};
  return {
    paymentId: resultado.id,
    qrCodeBase64: dadosPix.qr_code_base64,
    qrCodeTexto: dadosPix.qr_code,
  };
}

async function consultarPagamento(pagamentoId) {
  return mpFetch(`/v1/payments/${pagamentoId}`);
}

module.exports = { criarPagamentoPix, consultarPagamento };
