const { db, messaging } = require('../lib/firebaseAdmin');
const { preencherTemplate } = require('../lib/templates');
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

module.exports = async (req, res) => {
  // Protege o endpoint: só a Vercel (cron) ou uma chamada autenticada pode rodar.
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  try {
    const [clientesSnap, templatesSnap] = await Promise.all([
      db.ref('clientes').once('value'),
      db.ref('config/templates').once('value'),
    ]);

    const clientes = clientesSnap.val() || {};
    const templates = templatesSnap.val() || {};
    const hojeStr = new Date().toDateString();

    const log = { processados: 0, push3dias: 0, pushVencimento: 0, emails: 0, erros: [] };

    for (const [id, cliente] of Object.entries(clientes)) {
      if (cliente.status !== 'ativo') continue;
      log.processados++;

      const dias = diasAte(cliente.vencimento);
      let tipo = null;
      if (dias === 3) tipo = '3dias';
      else if (dias === 0) tipo = 'vencimento';
      if (!tipo) continue;

      // Evita duplicar envio no mesmo dia para o mesmo tipo
      const jaEnviadoHoje =
        cliente.ultimaNotificacao?.tipo === tipo &&
        new Date(cliente.ultimaNotificacao?.data || 0).toDateString() === hojeStr;
      if (jaEnviadoHoje) continue;

      const templateMsg = tipo === '3dias' ? templates.msg3dias : templates.msgVencimento;
      const corpo = preencherTemplate(templateMsg || '', cliente);

      // Push
      if (cliente.fcmToken && cliente.notificacaoAtiva) {
        try {
          await messaging.send({
            token: cliente.fcmToken,
            notification: { title: 'Aviso sobre seu plano', body: corpo },
            webpush: {
              fcmOptions: { link: `${process.env.APP_URL}/meu-plano.html?id=${id}` },
            },
          });
          if (tipo === '3dias') log.push3dias++;
          else log.pushVencimento++;
        } catch (err) {
          log.erros.push(`push ${id}: ${err.message}`);
        }
      }

      // E-mail
      if (cliente.email) {
        try {
          await resend.emails.send({
            from: process.env.RESEND_FROM,
            to: cliente.email,
            subject: preencherTemplate(templates.emailAssunto || 'Aviso de vencimento', cliente),
            text: preencherTemplate(templates.emailCorpo || corpo, cliente),
          });
          log.emails++;
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
