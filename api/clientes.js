const { db } = require('../lib/firebaseAdmin');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const snapshot = await db.ref('clientes').once('value');
      const data = snapshot.val() || {};
      const clientes = Object.entries(data).map(([id, c]) => ({ id, ...c }));
      return res.status(200).json(clientes);
    }

    if (req.method === 'POST') {
      const { nome, whatsapp, email, planoValor, servidor, vencimento } = req.body || {};

      if (!nome || !whatsapp || !vencimento) {
        return res.status(400).json({ erro: 'nome, whatsapp e vencimento são obrigatórios' });
      }

      const novoRef = db.ref('clientes').push();
      const cliente = {
        nome,
        whatsapp: String(whatsapp).replace(/\D/g, ''),
        email: email || '',
        planoValor: Number(planoValor) || 0,
        servidor: servidor || '',
        vencimento: Number(vencimento),
        status: 'ativo',
        fcmToken: null,
        notificacaoAtiva: false,
        ultimaNotificacao: { tipo: null, data: 0 },
        criadoEm: Date.now(),
      };

      await novoRef.set(cliente);
      return res.status(201).json({ id: novoRef.key, ...cliente });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  } catch (err) {
    console.error('Erro em /api/clientes:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
