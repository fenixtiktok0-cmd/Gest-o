// Integração com o Mercado Pago — PIX avulso (não recorrente), usado pra
// cobrar o cliente quando o teste vira oficial ou quando ele renova.

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

// Checkout hospedado pelo Mercado Pago. O cliente recebe uma URL segura e
// escolhe a forma de pagamento disponível no próprio Mercado Pago.
async function criarCobrancaCheckout({ referencia, email, nome, valor, descricao }) {
  const valorNumerico = Number(valor);
  if (!referencia || !Number.isFinite(valorNumerico) || valorNumerico <= 0) {
    throw new Error('Dados inválidos para gerar a cobrança.');
  }
  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  const resultado = await mpFetch('/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `renovacao-${referencia}` },
    body: JSON.stringify({
      items: [{
        title: descricao || 'Renovação MultiFlix', quantity: 1,
        currency_id: 'BRL', unit_price: Number(valorNumerico.toFixed(2)),
      }],
      payer: email ? { email } : undefined,
      external_reference: referencia,
      notification_url: `${appUrl}/api/webhook-mercadopago`,
      back_urls: appUrl ? {
        success: `${appUrl}/meu-plano.html`, pending: `${appUrl}/meu-plano.html`, failure: `${appUrl}/meu-plano.html`,
      } : undefined,
      auto_return: 'approved',
      metadata: { tipo: 'renovacao_multiflix', cliente: nome || '' },
    }),
  });
  if (!resultado.init_point) throw new Error('O Mercado Pago não retornou um link de pagamento.');
  return { preferenceId: resultado.id, linkPagamento: resultado.init_point };
}

// Pix exibido dentro da Central. O pagamento continua sendo criado e
// confirmado pela API oficial; nenhum dado sensível é enviado ao navegador.
async function criarCobrancaPixCentral({ referencia, email, valor, descricao }) {
  const valorNumerico = Number(valor);
  if (!referencia || !Number.isFinite(valorNumerico) || valorNumerico <= 0) throw new Error('Dados inválidos para gerar o Pix.');
  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  const resultado = await mpFetch('/v1/payments', {
    method: 'POST', headers: { 'X-Idempotency-Key': `renovacao-pix-${referencia}` },
    body: JSON.stringify({ transaction_amount: Number(valorNumerico.toFixed(2)), description: descricao || 'Renovação MultiFlix', payment_method_id: 'pix', payer: { email: email || 'cliente@sememail.com' }, external_reference: referencia, notification_url: `${appUrl}/api/webhook-mercadopago` })
  });
  const pix = resultado.point_of_interaction?.transaction_data || {};
  if (!resultado.id || !pix.qr_code) throw new Error('O Pix não foi disponibilizado agora. Tente novamente.');
  return { paymentId: String(resultado.id), copiaCola: pix.qr_code, imagem: pix.qr_code_base64 || '', expiraEm: resultado.date_of_expiration || null };
}

module.exports = { criarPagamentoPix, criarCobrancaCheckout, criarCobrancaPixCentral, consultarPagamento };
