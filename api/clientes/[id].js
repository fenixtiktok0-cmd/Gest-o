const { db } = require('../../lib/firebaseAdmin');

module.exports = async (req, res) => {
  const { id } = req.query;

  try {
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const atualizacoes = req.body || {};
      if (atualizacoes.whatsapp) {
        atualizacoes.whatsapp = String(atualizacoes.whatsapp).replace(/\D/g, '');
      }
      await db.ref(`clientes/${id}`).update(atualizacoes);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await db.ref(`clientes/${id}`).remove();
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['PATCH', 'PUT', 'DELETE']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  } catch (err) {
    console.error('Erro em /api/clientes/[id]:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
