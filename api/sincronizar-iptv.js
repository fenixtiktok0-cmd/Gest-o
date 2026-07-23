const { db } = require('../lib/firebaseAdmin');
const { sincronizarComPainelIPTV } = require('../lib/iptvSync');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { clienteId } = req.body || {};
    if (!clienteId) {
      return res.status(400).json({ erro: 'clienteId é obrigatório' });
    }

    const snap = await db.ref(`clientes/${clienteId}`).once('value');
    const cliente = snap.val();
    if (!cliente) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }
    if (!cliente.m3uLink) {
      return res.status(400).json({ erro: 'Esse cliente não tem link M3U cadastrado.' });
    }

    const templatesSnap = await db.ref('config/templates').once('value');
    const templates = templatesSnap.val() || {};

    const resultado = await sincronizarComPainelIPTV(clienteId, cliente, templates);

    if (resultado) {
      return res.status(200).json({
        ok: true,
        renovado: true,
        novoVencimento: resultado.cliente.vencimento,
        comprovante: resultado.comprovante,
        whatsapp: resultado.cliente.whatsapp,
      });
    }
    return res.status(200).json({
      ok: true,
      renovado: false,
      mensagem: 'Consultei o painel, mas não achei nenhuma renovação nova (a data lá está igual ou anterior à que já temos aqui).',
    });
  } catch (err) {
    console.error('Erro em /api/sincronizar-iptv:', err);
    return res.status(500).json({ erro: 'Erro interno ao sincronizar' });
  }
};
