const { db, messaging } = require('../lib/firebaseAdmin');
const { preencherTemplate } = require('../lib/templates');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  try {
    const [clientesSnap, configSnap] = await Promise.all([
      db.ref('clientes').once('value'),
      db.ref('config/templates').once('value'),
    ]);

    const clientes = clientesSnap.val() || {};
    const templates = configSnap.val() || {};
    const log = { processados: 0, emails: 0, avisosAcabando: 0, avisosAcabou: 0, erros: [] };

    for (const [id, cliente] of Object.entries(clientes)) {
      if (!cliente.emTeste) continue;
      log.processados++;

      const horasRestantes = (cliente.vencimento - Date.now()) / (1000 * 60 * 60);
      let tipo = null;
      if (horasRestantes <= 0) tipo = 'testeAcabou';
      else if (horasRestantes <= 1) tipo = 'testeAcabando';
      if (!tipo) continue;

      // Cada tipo só é enviado uma vez por cliente de teste
      if (cliente.ultimaNotificacao?.tipo === tipo) continue;

      const templateMsg = tipo === 'testeAcabando' ? templates.msgTesteAcabando : templates.msgTesteAcabou;
      const corpo = preencherTemplate(templateMsg || '', cliente, id);

      if (cliente.fcmToken && cliente.notificacaoAtiva) {
        try {
          await messaging.send({
            token: cliente.fcmToken,
            data: {
              title: tipo === 'testeAcabando' ? 'Seu teste está acabando!' : 'Seu teste terminou',
              body: corpo,
              link: `${process.env.APP_URL}/meu-plano.html?id=${id}`,
            },
          });
          if (tipo === 'testeAcabando') log.avisosAcabando++;
          else log.avisosAcabou++;
        } catch (err) {
          log.erros.push(`push ${id}: ${err.message}`);
        }
      }

      if (cliente.email) {
        try {
          const resultado = await resend.emails.send({
            from: process.env.RESEND_FROM,
            to: cliente.email,
            subject: tipo === 'testeAcabando' ? 'Seu teste está acabando!' : 'Seu teste terminou',
            text: corpo,
          });
          if (!resultado.error) log.emails++;
        } catch (err) {
          log.erros.push(`email ${id}: ${err.message}`);
        }
      }

      await db.ref(`clientes/${id}/ultimaNotificacao`).set({ tipo, data: Date.now() });
    }

    return res.status(200).json(log);
  } catch (err) {
    console.error('Erro no cron de testes:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
