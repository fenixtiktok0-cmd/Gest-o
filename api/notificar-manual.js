const { db, messaging } = require('../lib/firebaseAdmin');
const { preencherTemplate } = require('../lib/templates');

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

    const configSnap = await db.ref('config').once('value');
    const config = configSnap.val() || {};
    const templates = config.templates || {};
    const whatsappAdmin = config.whatsappAdmin;

    const resultados = [];

    for (const id of clienteIds) {
      const clienteSnap = await db.ref(`clientes/${id}`).once('value');
      const cliente = clienteSnap.val();

      if (!cliente || !cliente.fcmToken) {
        resultados.push({ id, enviado: false, motivo: 'sem token FCM' });
        continue;
      }

      const corpo = mensagemCustom || preencherTemplate(templates.msgManual || '', cliente);
      const linkClique = `${process.env.APP_URL}/meu-plano.html?id=${id}`;

      try {
        await messaging.send({
          token: cliente.fcmToken,
          data: {
            title: 'Aviso sobre seu plano',
            body: corpo,
            link: linkClique,
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
