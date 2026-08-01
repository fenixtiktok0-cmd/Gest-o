const { db, messaging } = require('../lib/firebaseAdmin');
const { consultarPagamento } = require('../lib/mercadopago');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

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

    // NÃO ativa o cliente aqui — o pagamento confirmado só significa que ele
    // pode ser ativado. A ativação de verdade (com a data real do painel IPTV)
    // continua sendo feita manualmente pelo admin, em "✅ Ativar oficial".
    await db.ref(`clientes/${clienteId}`).update({
      statusLead: 'pagamento_confirmado',
      ultimoPagamentoConfirmado: String(pagamentoId),
    });

    // Avisa só o admin — push e e-mail juntos, pra garantir que chegue
    const configSnap = await db.ref('config').once('value');
    const config = configSnap.val() || {};
    const corpoAdmin = `💰 ${cliente.nome} pagou! Valor: R$ ${Number(cliente.planoValor || 0).toFixed(2)}.\n\nAtiva ele no seu painel IPTV, depois volta aqui pra sincronizar e confirmar como oficial.`;

    if (config.adminFcmToken && config.adminNotificacaoAtiva) {
      try {
        await messaging.send({
          token: config.adminFcmToken,
          data: { title: '💰 Pagamento confirmado — falta ativar', body: corpoAdmin, link: `${process.env.APP_URL}/index.html` },
        });
      } catch (err) {
        console.error('Erro ao avisar admin por push:', err.message);
      }
    }

    if (config.adminEmail) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM,
          to: config.adminEmail,
          subject: `💰 Pagamento confirmado — ${cliente.nome} (falta ativar)`,
          text: corpoAdmin,
        });
      } catch (err) {
        console.error('Erro ao avisar admin por e-mail:', err.message);
      }
    }

    return res.status(200).json({ ok: true, pagamentoConfirmado: true });
  } catch (err) {
    console.error('Erro no webhook Mercado Pago:', err);
    return res.status(200).json({ ok: false }); // sempre 200 pro MP não ficar reenviando em loop
  }
};
