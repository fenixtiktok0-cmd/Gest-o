const { db, messaging } = require('../lib/firebaseAdmin');
const { preencherTemplate } = require('../lib/templates');
const { consultarContaXtream } = require('../lib/xtream');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const UM_DIA = 1000 * 60 * 60 * 24;

function diasAte(timestampVencimento) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(timestampVencimento);
  venc.setHours(0, 0, 0, 0);
  return Math.round((venc - hoje) / UM_DIA);
}

// Confere se o cliente foi renovado direto no painel IPTV de origem.
// Se a data lá estiver mais nova que a nossa, atualiza sozinho e
// dispara o mesmo aviso de renovação que o botão manual dispara.
async function sincronizarComPainelIPTV(id, cliente, templates) {
  if (!cliente.m3uLink) return null;

  const resultado = await consultarContaXtream(cliente.m3uLink);
  if (resultado.erro || !resultado.vencimento) return null;
  if (resultado.vencimento <= cliente.vencimento) return null;

  const clienteAtualizado = {
    ...cliente,
    vencimento: resultado.vencimento,
    status: 'ativo',
    ultimaNotificacao: { tipo: null, data: 0 },
  };

  await db.ref(`clientes/${id}`).update({
    vencimento: resultado.vencimento,
    status: 'ativo',
    ultimaNotificacao: { tipo: null, data: 0 },
  });

  await db.ref('financeiro').push({
    clienteId: id,
    clienteNome: cliente.nome,
    servidor: cliente.servidor || '—',
    valor: Number(cliente.planoValor) || 0,
    tipo: 'renovacao',
    data: Date.now(),
  });

  if (cliente.fcmToken && cliente.notificacaoAtiva) {
    try {
      const corpo = preencherTemplate(templates.comprovanteRenovacao || '', clienteAtualizado);
      await messaging.send({
        token: cliente.fcmToken,
        data: {
          title: 'Plano renovado! ✅',
          body: corpo,
          link: `${process.env.APP_URL}/meu-plano.html?id=${id}`,
        },
      });
    } catch (err) {
      console.error(`Erro ao notificar renovação automática (${id}):`, err.message);
    }
  }

  return clienteAtualizado;
}

module.exports = async (req, res) => {
  // Protege o endpoint: só a Vercel (cron) ou uma chamada autenticada pode rodar.
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  try {
    const [clientesSnap, configSnap] = await Promise.all([
      db.ref('clientes').once('value'),
      db.ref('config').once('value'),
    ]);

    let clientes = clientesSnap.val() || {};
    const config = configSnap.val() || {};
    const templates = config.templates || {};
    const whatsappAdmin = config.whatsappAdmin;
    const hojeStr = new Date().toDateString();

    const log = { processados: 0, emails: 0, renovacoesAutomaticas: 0, erros: [] };

    // Sincroniza com o painel IPTV primeiro (só quem tem link M3U salvo)
    const idsComM3U = Object.entries(clientes).filter(([, c]) => c.m3uLink).map(([id]) => id);
    for (const id of idsComM3U) {
      try {
        const atualizado = await sincronizarComPainelIPTV(id, clientes[id], templates);
        if (atualizado) {
          clientes[id] = atualizado;
          log.renovacoesAutomaticas++;
        }
      } catch (err) {
        log.erros.push(`sync IPTV ${id}: ${err.message}`);
      }
    }

    for (const [id, cliente] of Object.entries(clientes)) {
      if (cliente.status !== 'ativo') continue;
      log.processados++;

      const dias = diasAte(cliente.vencimento);
      let tipo = null;
      if (dias === 7) tipo = '7dias';
      else if (dias === 3) tipo = '3dias';
      else if (dias === 0) tipo = 'vencimento';
      else if (dias === -3) tipo = '3diasVencido';
      if (!tipo) continue;

      // Evita duplicar envio no mesmo dia para o mesmo tipo
      const jaEnviadoHoje =
        cliente.ultimaNotificacao?.tipo === tipo &&
        new Date(cliente.ultimaNotificacao?.data || 0).toDateString() === hojeStr;
      if (jaEnviadoHoje) continue;

      const mapaTemplate = {
        '7dias': templates.msg7dias,
        '3dias': templates.msg3dias,
        vencimento: templates.msgVencimento,
        '3diasVencido': templates.msg3diasVencido,
      };
      const templateMsg = mapaTemplate[tipo];
      const corpo = preencherTemplate(templateMsg || '', cliente);

      // Push
      if (cliente.fcmToken && cliente.notificacaoAtiva) {
        try {
          const linkClique = `${process.env.APP_URL}/meu-plano.html?id=${id}`;

          await messaging.send({
            token: cliente.fcmToken,
            data: {
              title: 'Aviso sobre seu plano',
              body: corpo,
              link: linkClique,
            },
          });
          log[`push_${tipo}`] = (log[`push_${tipo}`] || 0) + 1;
        } catch (err) {
          log.erros.push(`push ${id}: ${err.message}`);
        }
      }

      // E-mail
      if (cliente.email) {
        try {
          const resultado = await resend.emails.send({
            from: process.env.RESEND_FROM,
            to: cliente.email,
            subject: preencherTemplate(templates.emailAssunto || 'Aviso de vencimento', cliente),
            text: preencherTemplate(templates.emailCorpo || corpo, cliente),
          });
          if (resultado.error) {
            log.erros.push(`email ${id}: ${resultado.error.message || JSON.stringify(resultado.error)}`);
          } else {
            log.emails++;
          }
        } catch (err) {
          log.erros.push(`email ${id}: ${err.message}`);
        }
      }

      await db.ref(`clientes/${id}/ultimaNotificacao`).set({ tipo, data: Date.now() });
    }

    return res.status(200).json(log);
  } catch (err) {
    console.error('Erro no cron:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
