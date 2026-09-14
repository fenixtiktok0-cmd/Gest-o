const { db, messaging } = require('../lib/firebaseAdmin');
const { consultarPagamento } = require('../lib/mercadopago');
const { renovarNoMultiflix } = require('../lib/multiflix-renovacao');
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

    const referencia = String(pagamento.external_reference || '');
    if (referencia.startsWith('renovacao:')) {
      const renovacaoId = referencia.slice('renovacao:'.length);
      const renovacaoRef = db.ref(`renovacoes/${renovacaoId}`);
      const renovacaoSnap = await renovacaoRef.once('value');
      const renovacao = renovacaoSnap.val();
      if (!renovacao) return res.status(200).json({ ok: true, renovacaoNaoEncontrada: true });
      if (renovacao.status === 'concluida') return res.status(200).json({ ok: true, jaProcessado: true });
      if (String(renovacao.paymentId || '') && String(renovacao.paymentId) !== String(pagamentoId)) {
        return res.status(200).json({ ok: true, pagamentoDivergente: true });
      }
      if (Math.abs(Number(pagamento.transaction_amount) - Number(renovacao.valor)) > 0.009) {
        console.error('Pagamento com valor diferente na renovação:', renovacaoId);
        return res.status(200).json({ ok: true, valorDivergente: true });
      }

      // O painel MultiFlix também guarda o ID do pagamento: chamadas repetidas
      // do webhook não conseguem somar dias duas vezes.
      const resultado = await renovarNoMultiflix(renovacao.usuario, String(pagamentoId));
      const clienteRef = db.ref(`clientes/${renovacao.clienteId}`);
      const clienteSnap = await clienteRef.once('value');
      const cliente = clienteSnap.val();
      if (!cliente) throw new Error('Cliente da renovação não encontrado.');
      const novoVencimento = Number(resultado.novoVencimento);
      await db.ref().update({
        [`clientes/${renovacao.clienteId}/vencimento`]: novoVencimento,
        [`clientes/${renovacao.clienteId}/status`]: 'ativo',
        [`clientes/${renovacao.clienteId}/pagamentoPendenteRenovacao`]: false,
        [`clientes/${renovacao.clienteId}/ultimoPagamentoConfirmado`]: String(pagamentoId),
        [`renovacoes/${renovacaoId}`]: { ...renovacao, status: 'concluida', paymentId: String(pagamentoId), concluidaEm: Date.now(), novoVencimento },
      });

      const texto = `✅ Pagamento confirmado!\n\nSua renovação MultiFlix foi concluída com sucesso.\n\n📅 Novo vencimento: ${new Date(novoVencimento).toLocaleDateString('pt-BR')}.`;
      if (cliente.fcmToken && cliente.notificacaoAtiva) {
        try { await messaging.send({ token: cliente.fcmToken, data: { title: 'Plano renovado! ✅', body: texto, link: `${process.env.APP_URL}/meu-plano.html?id=${renovacao.clienteId}` } }); }
        catch (err) { console.error('Erro ao enviar push de renovação automática:', err.message); }
      }
      if (cliente.email) {
        try { await resend.emails.send({ from: process.env.RESEND_FROM, to: cliente.email, subject: 'Sua renovação MultiFlix foi concluída ✅', text: texto }); }
        catch (err) { console.error('Erro ao enviar e-mail de renovação automática:', err.message); }
      }
      return res.status(200).json({ ok: true, renovacaoConcluida: true });
    }

    const clienteId = referencia;
    if (!clienteId) return res.status(200).json({ ok: true, semReferencia: true });

    const clienteSnap = await db.ref(`clientes/${clienteId}`).once('value');
    const cliente = clienteSnap.val();
    if (!cliente) return res.status(200).json({ ok: true, clienteNaoEncontrado: true });

    // Evita processar o mesmo pagamento duas vezes (o Mercado Pago pode reenviar o webhook)
    if (cliente.ultimoPagamentoConfirmado === String(pagamentoId)) {
      return res.status(200).json({ ok: true, jaProcessado: true });
    }

    // NÃO renova/ativa o cliente aqui — o pagamento confirmado só significa que
    // ele pode ser processado. A renovação/ativação de verdade (com a data real
    // do painel IPTV) continua sendo feita manualmente pelo admin.
    const atualizacao = {
      pagamentoPendenteRenovacao: true,
      ultimoPagamentoConfirmado: String(pagamentoId),
    };
    if (cliente.origemCaptura) atualizacao.statusLead = 'pagamento_confirmado';
    await db.ref(`clientes/${clienteId}`).update(atualizacao);

    // Avisa só o admin — push e e-mail juntos, pra garantir que chegue
    const configSnap = await db.ref('config').once('value');
    const config = configSnap.val() || {};
    const acaoTexto = cliente.emTeste
      ? 'Ativa ele no seu painel IPTV, depois volta aqui pra sincronizar e confirmar como oficial.'
      : 'Renova ele no seu painel IPTV, depois volta aqui pra sincronizar e confirmar a renovação.';
    const corpoAdmin = `💰 ${cliente.nome} pagou! Valor: R$ ${Number(cliente.planoValor || 0).toFixed(2)}.\n\n${acaoTexto}`;

    if (config.adminFcmToken && config.adminNotificacaoAtiva) {
      try {
        await messaging.send({
          token: config.adminFcmToken,
          data: { title: '💰 Pagamento confirmado — falta processar', body: corpoAdmin, link: `${process.env.APP_URL}/index.html` },
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
          subject: `💰 Pagamento confirmado — ${cliente.nome} (falta processar)`,
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
