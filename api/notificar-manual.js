const { db, messaging } = require('../lib/firebaseAdmin');
const { preencherTemplate } = require('../lib/templates');

function diasAte(timestampVencimento) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(timestampVencimento); venc.setHours(0, 0, 0, 0);
  return Math.round((venc - hoje) / (1000 * 60 * 60 * 24));
}

function escolherTemplate(templates, dias) {
  if (dias >= 7) return templates.msg7dias;
  if (dias === 3 || (dias > 0 && dias < 7)) return templates.msg3dias;
  if (dias === 0) return templates.msgVencimento;
  if (dias <= -3) return templates.msg3diasVencido;
  return templates.msgVencido || templates.msgVencimento;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { clienteIds, mensagemCustom } = req.body || {};
    if (!Array.isArray(clienteIds) || clienteIds.length === 0) {
      return res.status(400).json({ erro: 'clienteIds é obrigatório (array)' });
    }

    const configSnap = await db.ref('config/templates').once('value');
    const templates = configSnap.val() || {};

    const resultados = [];

    for (const id of clienteIds) {
      const clienteSnap = await db.ref(`clientes/${id}`).once('value');
      const cliente = clienteSnap.val();

      if (!cliente || !cliente.fcmToken) {
        resultados.push({ id, enviado: false, motivo: 'sem token FCM' });
        continue;
      }

      const dias = diasAte(cliente.vencimento);
      const corpo = mensagemCustom || preencherTemplate(escolherTemplate(templates, dias) || '', cliente);

      try {
        await messaging.send({
          token: cliente.fcmToken,
          notification: {
            title: 'Aviso sobre seu plano',
            body: corpo,
          },
          webpush: {
            fcmOptions: {
              link: `${process.env.APP_URL}/meu-plano.html?id=${id}`,
            },
          },
        });

        await db.ref(`clientes/${id}/ultimaNotificacao`).set({
          tipo: 'manual',
          data: Date.now(),
        });

        resultados.push({ id, enviado: true });
      } catch (err) {
        resultados.push({ id, enviado: false, motivo: err.message });
      }
    }

    return res.status(200).json({ resultados });
  } catch (err) {
    console.error('Erro em /api/notificar-manual:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
