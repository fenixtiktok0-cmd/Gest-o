const { db } = require('../lib/firebaseAdmin');
const { criarPagamentoPix } = require('../lib/mercadopago');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { clienteId } = req.body || {};
    if (!clienteId) return res.status(400).json({ erro: 'clienteId é obrigatório' });

    const clienteSnap = await db.ref(`clientes/${clienteId}`).once('value');
    const cliente = clienteSnap.val();
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });
    if (!cliente.planoValor || cliente.planoValor <= 0) {
      return res.status(400).json({ erro: 'Esse cliente não tem valor especial definido ainda' });
    }

    const pix = await criarPagamentoPix({
      clienteId,
      email: cliente.email,
      valor: cliente.planoValor,
      descricao: `Ativação do plano — ${cliente.nome}`,
    });

    await db.ref(`clientes/${clienteId}`).update({
      statusLead: 'pagamento_pendente',
      ultimoPagamentoId: pix.paymentId,
    });

    return res.status(200).json({
      ok: true,
      qrCodeBase64: pix.qrCodeBase64,
      qrCodeTexto: pix.qrCodeTexto,
      valor: cliente.planoValor,
    });
  } catch (err) {
    console.error('Erro em /api/gerar-pix-cliente:', err);
    return res.status(500).json({ erro: err.message || 'Erro interno' });
  }
};
