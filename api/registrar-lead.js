const { db } = require('../lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { nome, whatsapp, email } = req.body || {};
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
      fcmToken: null,
      notificacaoAtiva: false,
      ultimaNotificacao: { tipo: null, data: 0 },
      criadoEm: Date.now(),
    };

    const resultado = await db.ref('clientes').push(novoLead);
    const leadId = resultado.key;

    const configSnap = await db.ref('config/whatsappAdmin').once('value');
    const whatsappAdmin = configSnap.val() || '';

    return res.status(200).json({ ok: true, leadId, whatsappAdmin });
  } catch (err) {
    console.error('Erro em /api/registrar-lead:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
