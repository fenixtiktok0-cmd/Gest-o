const { db, messaging } = require('../lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { nome, whatsapp, email, fcmToken } = req.body || {};
    if (!nome || !whatsapp) {
      return res.status(400).json({ erro: 'nome e whatsapp são obrigatórios' });
    }

    const novoLead = {
      nome,
      whatsapp: whatsapp.replace(/\D/g, ''),
      email: email || '',
      usuario: '',
      senha: '',
      m3uLink: '',
      servidor: '',
      aplicativosIds: [],
      planoValor: 0,
      vencimento: null,
      emTeste: false,
      musica: false,
      status: 'ativo',
      origemCaptura: true,
      statusLead: 'lead',
      fcmToken: fcmToken || null,
      notificacaoAtiva: !!fcmToken,
      ultimaNotificacao: { tipo: null, data: 0 },
      criadoEm: Date.now(),
    };

    const resultado = await db.ref('clientes').push(novoLead);
    const leadId = resultado.key;

    // Avisa o admin na hora, se ele já tiver ativado as próprias notificações
    const configSnap = await db.ref('config').once('value');
    const config = configSnap.val() || {};
    if (config.adminFcmToken && config.adminNotificacaoAtiva) {
      try {
        await messaging.send({
          token: config.adminFcmToken,
          data: {
            title: '🧪 Teste pendente',
            body: `${nome} pediu um teste grátis — entra no painel pra liberar.`,
            link: `${process.env.APP_URL}/index.html`,
          },
        });
      } catch (err) {
        console.error('Erro ao avisar admin sobre novo lead:', err.message);
      }
    }

    return res.status(200).json({ ok: true, leadId });
  } catch (err) {
    console.error('Erro em /api/registrar-lead:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
