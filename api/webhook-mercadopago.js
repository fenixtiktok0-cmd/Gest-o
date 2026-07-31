const { db, messaging } = require('../lib/firebaseAdmin');
const { enviarPushSeguro } = require('../lib/pushHelper');
const { consultarPagamento } = require('../lib/mercadopago');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  try {
    const tipo = req.query.type || req.body?.type || req.body?.topic;
    const pagamentoId = req.query['data.id'] || req.body?.data?.id || req.body?.resource;

    if (tipo !== 'payment' || !pagamentoId) {
      return res.status(200).json({ ok: true, ignorado: true });
    }

    const pagamento = await consultarPagamento(pagamentoId);
    if (pagamento.status !== 'approved') {
      return res.status(200).json({ ok: true, statusPagamento: pagamento.status });
    }

    const clienteId = pagamento.external_reference;
    if (!clienteId) return res.status(200).json({ ok: true, semReferencia: true });

    const clienteSnap = await db.ref(`clientes/${clienteId}`).once('value');
    const cliente = clienteSnap.val();
    if (!cliente) return res.status(200).json({ ok: true, clienteNaoEncontrado: true });

    // Evita processar o mesmo pagamento duas vezes (o Mercado Pago pode reenviar o webhook)
    if (cliente.ultimoPagamentoConfirmado === String(pagamentoId)) {
      return res.status(200).json({ ok: true, jaProcessado: true });
    }

    const novoVencimento = Date.now() + TRINTA_DIAS;

    await db.ref(`clientes/${clienteId}`).update({
      emTeste: false,
      status: 'ativo',
      statusLead: 'ativo',
      vencimento: novoVencimento,
      ultimoPagamentoConfirmado: String(pagamentoId),
    });

    await db.ref('financeiro').push({
      clienteId,
      clienteNome: cliente.nome,
      servidor: cliente.servidor || '—',
      produto: 'iptv',
      valor: cliente.planoValor || 0,
      tipo: 'cadastro',
      data: Date.now(),
    });

    const linkClique = `${process.env.APP_URL}/meu-plano.html?id=${clienteId}`;
    const corpo = `Olá ${cliente.nome}! Seu plano foi ativado com sucesso ✅\nVencimento: ${new Date(novoVencimento).toLocaleDateString('pt-BR')}\nValor: R$ ${Number(cliente.planoValor || 0).toFixed(2)}\nSeja bem-vindo(a)!`;

    if (cliente.fcmToken) {
      await enviarPushSeguro({
        messaging,
        db,
        caminhoRegistro: `clientes/${clienteId}`,
        token: cliente.fcmToken,
        payload: { title: 'Plano ativado! ✅', body: corpo, link: linkClique },
      });
    }

    if (cliente.email) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM,
          to: cliente.email,
          subject: 'Plano ativado! ✅',
          text: corpo,
        });
      } catch (err) {
        console.error('Erro ao enviar e-mail de confirmação:', err.message);
      }
    }

    return res.status(200).json({ ok: true, ativado: true });
  } catch (err) {
    console.error('Erro no webhook Mercado Pago:', err);
    return res.status(200).json({ ok: false }); // sempre 200 pro MP não ficar reenviando em loop
  }
};
