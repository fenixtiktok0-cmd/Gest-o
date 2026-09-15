const { db, messaging } = require('../lib/firebaseAdmin');
const { consultarPagamento } = require('../lib/mercadopago');
const { renovarNoMultiflix, ativarTesteNoMultiflix } = require('../lib/multiflix-renovacao');
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

      let emailEnviado = false;
      let texto = `✅ Pagamento confirmado!\n\nA renovação do seu aplicativo foi concluída com sucesso.\n\n📅 Novo vencimento: ${new Date(novoVencimento).toLocaleDateString('pt-BR')}.\n\n🔄 Feche e abra novamente o aplicativo para atualizar sua lista e validar o acesso.`;
      if (cliente.fcmToken && cliente.notificacaoAtiva) {
        try { await messaging.send({ token: cliente.fcmToken, data: { title: 'Plano renovado! ✅', body: texto, link: `${process.env.APP_URL}/meu-plano.html?id=${renovacao.clienteId}` } }); }
        catch (err) { console.error('Erro ao enviar push de renovação automática:', err.message); }
      }
      if (cliente.email && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
        try {
          const envio = await resend.emails.send({ from: process.env.RESEND_FROM, to: cliente.email, subject: 'Sua renovação MultiFlix foi concluída ✅', text: texto });
          emailEnviado = !envio?.error;
          if (envio?.error) console.error('Erro ao enviar e-mail de renovação automática:', envio.error.message || envio.error);
        }
        catch (err) { console.error('Erro ao enviar e-mail de renovação automática:', err.message); }
      }
      if (emailEnviado) texto += '\n\n📧 Também enviamos a confirmação para o e-mail cadastrado.';
      await renovacaoRef.update({ emailEnviado, notificacaoCentralEm: Date.now() });
      if (/^[a-f0-9]{64}$/.test(String(renovacao.sessaoHash || ''))) {
        await db.ref(`centralNotificacoes/${renovacao.sessaoHash}`).push({ mensagem: texto, criadoEm: Date.now(), tipo: 'renovacao_concluida' });
      }
      return res.status(200).json({ ok: true, renovacaoConcluida: true });
    }

    if (referencia.startsWith('contratacao:')) {
      const contratacaoId = referencia.slice('contratacao:'.length);
      const contratoRef = db.ref(`centralContratacoes/${contratacaoId}`);
      const contrato = (await contratoRef.once('value')).val();
      if (!contrato) return res.status(200).json({ ok: true, contratacaoNaoEncontrada: true });
      if (contrato.status === 'concluida') return res.status(200).json({ ok: true, jaProcessado: true });
      if (String(contrato.paymentId || '') !== String(pagamentoId) || Math.abs(Number(pagamento.transaction_amount) - Number(contrato.plano?.valor)) > 0.009) return res.status(200).json({ ok: true, pagamentoDivergente: true });
      const resultado = await ativarTesteNoMultiflix(contrato.usuario, String(pagamentoId), contrato.plano);
      const novoVencimento = Number(resultado.novoVencimento);
      if (!novoVencimento) throw new Error('O MultiFlix não retornou o novo vencimento da ativação.');
      const m3uLink = `http://lista.x.fenixsocial.site/get.php?username=${encodeURIComponent(contrato.usuario)}&password=${encodeURIComponent(contrato.senha)}&type=m3u_plus&output=ts`;
      const cliente = { nome: contrato.nome, whatsapp: contrato.telefone, email: contrato.email, usuario: contrato.usuario, senha: contrato.senha, m3uLink, servidor: 'MULTIFLIX', grupoId: contrato.grupoId, tipoPlano: contrato.plano.nome, valorPlano: Number(contrato.plano.valor), vencimento: novoVencimento, status: 'ativo', emTeste: false, ocultarAdulto: false, criadoEm: Date.now(), atualizadoEm: Date.now(), ultimoPagamentoConfirmado: String(pagamentoId), origemCaptura: 'central' };
      try {
        await db.ref().update({
          [`clientes/${contrato.clienteId}`]: cliente,
          [`centralContratacoes/${contratacaoId}`]: { ...contrato, status: 'concluida', concluidaEm: Date.now(), novoVencimento, paymentId: String(pagamentoId) },
        });
        const confirmado = (await db.ref(`clientes/${contrato.clienteId}`).once('value')).val();
        if (!confirmado?.usuario || confirmado.usuario !== contrato.usuario) throw new Error('O Gestor não confirmou a gravação do novo cliente.');
      } catch (erroCadastro) {
        const pendencia = { id: contratacaoId, clienteId: contrato.clienteId, nome: contrato.nome, whatsapp: contrato.telefone, email: contrato.email, usuario: contrato.usuario, senha: contrato.senha, grupoId: contrato.grupoId, plano: contrato.plano, novoVencimento, pagamentoId: String(pagamentoId), status: 'ativado_pendente_cadastro', erro: String(erroCadastro.message || erroCadastro).slice(0,180), criadoEm: Date.now() };
        await db.ref().update({
          [`centralContratacoes/${contratacaoId}`]: { ...contrato, ...pendencia },
          [`centralPendenciasCadastro/${contratacaoId}`]: pendencia,
        });
        await db.ref('centralAtendimentos').push({ clienteId: '', nome: contrato.nome || 'Cadastro pendente', whatsapp: contrato.telefone, tipo: 'cadastro_pendente', detalhe: `Pagamento aprovado; acesso ${contrato.usuario} ativado. Cadastro no Gestor pendente: ${pendencia.erro}`, criadoEm: Date.now(), contratacaoId });
        if (/^[a-f0-9]{64}$/.test(String(contrato.sessaoHash || ''))) await db.ref(`centralNotificacoes/${contrato.sessaoHash}`).push({ mensagem: '✅ Pagamento confirmado e acesso ativado. Estamos finalizando seu cadastro no Gestor; você receberá a confirmação completa em breve.', criadoEm: Date.now(), tipo: 'cadastro_pendente' });
        return res.status(200).json({ ok: true, ativadoCadastroPendente: true });
      }
      let texto = `✅ Pagamento confirmado e acesso ativado!\n\n📦 Plano: ${contrato.plano.nome}\n📅 Vencimento: ${new Date(novoVencimento).toLocaleDateString('pt-BR')}\n\n🔐 Usuário: ${contrato.usuario}\n🔑 Senha: ${contrato.senha}\n\n🔄 Feche e abra novamente o aplicativo para validar o acesso.`;
      if (contrato.email && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
        try { const envio = await resend.emails.send({ from: process.env.RESEND_FROM, to: contrato.email, subject: 'Seu acesso MultiFlix foi ativado ✅', text: texto + '\n\nÁrea do Cliente: https://x.fenixsocial.site/cliente.html' }); if (!envio?.error) texto += '\n\n📧 Também enviamos esta confirmação ao seu e-mail.'; }
        catch (err) { console.error('Erro ao enviar e-mail da contratação:', err.message); }
      }
      if (/^[a-f0-9]{64}$/.test(String(contrato.sessaoHash || ''))) await db.ref(`centralNotificacoes/${contrato.sessaoHash}`).push({ mensagem: texto, criadoEm: Date.now(), tipo: 'contratacao_concluida' });
      return res.status(200).json({ ok: true, contratacaoConcluida: true });
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
